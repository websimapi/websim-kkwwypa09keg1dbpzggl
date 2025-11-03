// --- PERSISTENCE SETUP ---
const room = new WebsimSocket();
const COLLECTION_TYPE = "chain_state_v1";
let stateRecordId = null;

// --- CONFIG ---
const DEFAULT_CONFIG = {
  devHandle: "@XZYORBITZ", // Placeholder, will be replaced by actual creator username if possible
  devSplit: 0.5,
  creditToToken: 1000,          // minted tokens per 1 ♦credit tip
  blockIntervalSec: 60,         // 60 seconds interval
  genesisInitialized: false,
  seedPublicKey: null
};

// Global state variable placeholder (always use getState/saveState)
let stateCache = null;
let uiUpdateCallback = () => {};

export function setUIUpdateCallback(cb) {
    uiUpdateCallback = cb;
}

// --- UTIL ---
async function getState() {
  if (stateCache && stateRecordId) return stateCache;
  
  // Try loading from Websim Records
  try {
      // Fetch all records, assuming only one primary state record for the chain
      // Note: Websim collections return newest records first by default.
      const records = await room.collection(COLLECTION_TYPE).getList();
      
      const defaultState = JSON.parse(JSON.stringify({ config: DEFAULT_CONFIG, chain: [], accounts: {}, pendingTips: [], autoencoderState: {} }));

      if (records && records.length > 0) {
          // Use the newest one
          const record = records[0]; 
          stateRecordId = record.id;
          
          stateCache = {
              config: record.config || DEFAULT_CONFIG,
              chain: record.chain || [],
              accounts: record.accounts || {},
              pendingTips: record.pendingTips || [],
              autoencoderState: record.autoencoderState || {},
          };
      } else {
          // No record found, initialize fresh state structure
          stateCache = defaultState;
      }
  } catch (e) {
      console.error("Error accessing Websim Records during initial load, initializing fresh state.", e);
      stateCache = JSON.parse(JSON.stringify({ config: DEFAULT_CONFIG, chain: [], accounts: {}, pendingTips: [], autoencoderState: {} }));
  }
  return stateCache;
}

async function saveState(state) {
  stateCache = state;
  const dataToSave = {
      type: COLLECTION_TYPE, // Required when creating a record
      config: state.config,
      chain: state.chain,
      accounts: state.accounts,
      pendingTips: state.pendingTips,
      autoencoderState: state.autoencoderState,
  };
  
  try {
      if (stateRecordId) {
          // Update existing record
          await room.collection(COLLECTION_TYPE).update(stateRecordId, dataToSave);
      } else {
          // Create new record (Genesis state)
          const newRecord = await room.collection(COLLECTION_TYPE).create(dataToSave);
          stateRecordId = newRecord.id;
      }
  } catch(e) {
      console.error("Error saving project state to Websim Records:", e);
  }
}

function nowSec(){ return Math.floor(Date.now()/1000); }

async function sha256(str){
  // simple browser SubtleCrypto implementation
  const enc = new TextEncoder();  
  return crypto.subtle.digest("SHA-256", enc.encode(str)).then(buf => {
    const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join(''); 
    return h;
  });
}

function merkleRoot(txs){
  // simple merkle-like: hash concat of tx hashes
  return sha256(txs.map(tx=>JSON.stringify(tx)).join("|"));
}

function ensureAccount(state, userId, display){
  if(!state.accounts[userId]) state.accounts[userId] = {display: display||userId, tokenBalance:0, staked:0, lastClaim:0};
}

// --- GENESIS ---
async function initGenesis(state, tip) {
  // tip: {author, credits, handle}
  state.config.genesisInitialized = true;
  const mint = tip.credits * state.config.creditToToken;
  
  const genesisTx = { 
    type:"GENESIS", 
    from: tip.author, 
    credits: tip.credits, 
    time: nowSec(),
    mintTokens: mint 
  };
  
  const baseBlock = {
    index: 0,
    timestamp: nowSec(),
    prevHash: "0",
    txs: [genesisTx], 
    meta: { note: "Genesis created by seed tip" }
  };
  
  baseBlock.merkleRoot = await merkleRoot(baseBlock.txs);
  baseBlock.blockHash = await sha256(JSON.stringify(baseBlock));
  baseBlock.signature = "SIG_BY_DEV_SEED"; // placeholder
  state.chain = [baseBlock];
  // seed public key can be derived or assigned
  state.config.seedPublicKey = "seed_pub_placeholder";
  
  // Mint tokens for genesis tip
  const devShare = mint * state.config.devSplit;
  const playerShare = mint - devShare;
  
  const devUserId = state.config.devHandle.replace('@', '');
  
  ensureAccount(state, devUserId, state.config.devHandle);
  state.accounts[devUserId].tokenBalance += devShare;
  
  ensureAccount(state, tip.author, tip.handle);
  state.accounts[tip.author].tokenBalance += playerShare;
  
  console.log(`Genesis Block created. Minted ${mint} tokens.`);
  await saveState(state);
  return baseBlock;
}

// --- TIP HANDLER ---
async function handleIncomingComment(comment) {
  // comment contains: id, author, handle, content, credits
  
  const state = await getState();
  const credits = comment.credits || 0;
  if (credits < 10) { // Updated minimum tip requirement
    console.log(`Ignoring incoming tip of ${credits} credits: Minimum 10 credits required for minting trigger.`);
    return state; 
  }
  
  const devUserId = state.config.devHandle.replace('@', '');
  
  // 1. If genesis not initialized, only allow dev
  if (!state.config.genesisInitialized) {
    if (comment.author !== devUserId) {
      // User handle check: Remove @ if present in config
      console.log(`Tip from ${comment.author} rejected: Genesis not initialized.`);
      state.pendingTips.push({type:"COMMENT", comment});
      await saveState(state);
      return state;
    } else {
      console.log("Genesis seed tip received.");
      await initGenesis(state, comment);
      return state;
    }
  }
  
  // 2. Normal tip => create tx, mint tokens
  const mintTokens = credits * state.config.creditToToken;
  const devShare = mintTokens * state.config.devSplit;
  const playerShare = mintTokens - devShare;
  
  ensureAccount(state, devUserId, state.config.devHandle);
  ensureAccount(state, comment.author, comment.handle);
  
  state.accounts[devUserId].tokenBalance += devShare;
  state.accounts[comment.author].tokenBalance += playerShare;
  
  // add tx to pendingTips
  const tx = { 
    type:"TIP", 
    from: comment.author, 
    credits, 
    mintTokens, 
    devShare, 
    playerShare, 
    time: nowSec(), 
    commentId: comment.id 
  };
  state.pendingTips.push(tx);
  console.log(`New TIP TX added: ${tx.from} tipped ${credits} credits, minted ${mintTokens} tokens.`);
  await saveState(state);
  return state;
}

// --- BLOCK FINALIZER (run every blockIntervalSec) ---
async function finalizeBlock() {
  const state = await getState();
  if (!state.config.genesisInitialized) return;
  if (!state.pendingTips || state.pendingTips.length===0) return;
  
  const txs = state.pendingTips.splice(0, state.pendingTips.length);
  const prev = state.chain[state.chain.length-1] || {blockHash: "0"};
  const block = { index: state.chain.length, timestamp: nowSec(), prevHash: prev.blockHash, txs };
  
  block.merkleRoot = await merkleRoot(txs);
  block.blockHash = await sha256(JSON.stringify(block));
  block.signature = "SIG_PLACEHOLDER";
  state.chain.push(block);
  
  // update autoencoderState (deterministic transform)
  state.autoencoderState = updateAutoencoder(state, txs);
  
  console.log(`Block ${block.index} finalized.`);
  await saveState(state);
  return block;
}

// --- SIMPLE AUTOENCODER (deterministic) ---
function updateAutoencoder(state, txs) {
  // vector: [numTips, totalCredits, numAccounts, chainLength]
  const tipsTxs = txs.filter(t => t.type === "TIP");
  const numTips = tipsTxs.length;
  const totalCredits = tipsTxs.reduce((s,t)=>s+(t.credits||0),0);
  
  // Simulate early stage reward bias by dividing by a function of chain length
  const chainLength = state.chain.length;
  const V = [numTips, totalCredits, Object.keys(state.accounts).length, chainLength];
  
  // Apply deterministic transform (Tanh mapping, influenced by chain length for decay)
  // Bias: early blocks have larger divisor (10 + chainLength) leading to higher initial tanh output (closer to 1), simulating high early APY.
  const C = V.map((v,i)=> Math.tanh((v + 1) * (i+1) / (10 + chainLength)));
  
  return { encoderSeed: state.config.seedPublicKey, compressedState: JSON.stringify(C) };
}

// --- MINUTE-REWARD LOOP (run on interval) ---
async function runMinuteCycle() {
  const state = await getState();
  if (!state.config.genesisInitialized) return;

  // 1. Compute Reward Rate R using compressedState
  const C = JSON.parse(state.autoencoderState?.compressedState || "[0,0,0,0]");
  
  // Heuristic: Use a combination of C vectors to determine activity factor (higher C means more activity/earlier chain state)
  const activityScore = C.reduce((a, b) => a + b, 0) / C.length; 
  
  const minRate = 0.00001; // 0.001% per minute base
  const maxRate = 0.001;   // 0.1% per minute max
  
  // Reward Rate (R): scales exponentially based on activity score from min to max
  const rewardRate = minRate + (maxRate - minRate) * activityScore * activityScore; 
  
  const totalStaked = Object.values(state.accounts).reduce((s,a)=>s + (a.staked||0),0);
  
  if (totalStaked === 0) {
      console.log("No tokens staked, skipping reward cycle.");
      return await saveState(state);
  }

  const payouts = [];
  let totalRewardTokens = 0;
  const devUserId = state.config.devHandle.replace('@', '');

  for (const userId of Object.keys(state.accounts)) {
    const acc = state.accounts[userId];
    if ((acc.staked||0) <= 0) continue;
    
    // Reward calculation
    const tokenReward = acc.staked * rewardRate; // Removed Math.floor here to allow fractional accumulation
    
    if (tokenReward > 0) {
        totalRewardTokens += tokenReward;
        acc.tokenBalance += tokenReward;
        
        // Optionally perform an automated tip in ♦credits mapped back from tokens
        // We only send tips if the received reward, floored to 0 decimal places, is large enough
        const creditsToSend = Math.floor(tokenReward / state.config.creditToToken);
        
        // Only send auto-tip if credits > 0 AND it's not the developer (to avoid dev receiving recursive tips)
        if (creditsToSend >= 10 && userId !== devUserId) { // Ensure minimum tip of 10 credits
            payouts.push({ userId, display: acc.display, creditsToSend, tokenReward });
        }
    }
  }

  // Record reward TX for ledger
  if (totalRewardTokens > 0) {
      const rewardTx = { type: "REWARD", amount: totalRewardTokens, rate: rewardRate, time: nowSec() };
      state.pendingTips.push(rewardTx);
  }
  
  await saveState(state);

  // 2. Execute automated tipping via websim.postComment (Async operation)
  for (const p of payouts) {
      // Use [AUTO] tag to prevent re-minting
      const content = `[AUTO PAYOUT] Genesis Chain Reward: ${p.display} receives ${p.creditsToSend} ♦ credits (Token Yield: ${p.tokenReward} TK)`;
      try {
          console.log(`Executing auto payout for ${p.display}: ${p.creditsToSend} credits`);
          // Note: Since programmatic tipping is run as the developer if using a stored session,
          // this transaction will originate from the dev account.
          await window.websim.postComment({ content, images: [], credits: p.creditsToSend });
      } catch(e) {
          console.warn(`Auto tip failed for ${p.display}. Is user interaction required?`, e);
      }
  }
}

// --- EXPORTED UI/INTERACTION FUNCTIONS ---

export async function getCurrentState() {
    const state = await getState();
    
    // Calculate total supply and staked amounts for UI
    const totalSupply = Object.values(state.accounts).reduce((s, a) => s + (a.tokenBalance || 0) + (a.staked || 0), 0);
    const totalStaked = Object.values(state.accounts).reduce((s, a) => s + (a.staked || 0), 0);

    const C = JSON.parse(state.autoencoderState?.compressedState || "[0,0,0,0]");
    const activityScore = C.reduce((a, b) => a + b, 0) / C.length; 
    const minRate = 0.00001;
    const maxRate = 0.001;
    const currentRate = minRate + (maxRate - minRate) * activityScore * activityScore; 
    
    const interval = state.config.blockIntervalSec;
    const nextCycleSecs = interval - (nowSec() % interval);
    
    return {
        ...state,
        totals: {
            totalSupply,
            totalStaked,
            currentRate: (currentRate * 60 * 24 * 365 * 100).toFixed(2), // Approximate APY calculation
            nextCycleSecs
        }
    };
}

export async function postUserTip(content, credits) {
    if (credits < 10) return { success: false, message: "Minimum tip is 10 credits." };

    // This call triggers the websim UI and subsequent 'comment:created' event if successful
    try {
        await window.websim.postComment({ content, images: [], credits });
        return { success: true, message: "Awaiting block confirmation..." };
    } catch(e) {
        return { success: false, message: `Error posting comment/tip. User interaction required. (${e.message || 'Unknown error'})` };
    }
}

export async function stakeTokens(userId, amount) {
    const state = await getState();
    ensureAccount(state, userId);
    const stakeAmount = parseFloat(amount); // Use float parse

    if (stakeAmount <= 0) return { success: false, message: "Stake amount must be positive." };
    if (state.accounts[userId].tokenBalance < stakeAmount) return { success: false, message: "Insufficient token balance." };

    state.accounts[userId].tokenBalance -= stakeAmount;
    state.accounts[userId].staked = (state.accounts[userId].staked || 0) + stakeAmount;
    
    const tx = { type: "STAKE", from: userId, amount: stakeAmount, time: nowSec() };
    state.pendingTips.push(tx); 
    
    await saveState(state);
    uiUpdateCallback();
    return { success: true, message: `Staked ${stakeAmount.toLocaleString()} tokens. Pending block inclusion.` };
}

export async function unstakeTokens(userId, amount) {
    const state = await getState();
    ensureAccount(state, userId);
    const unstakeAmount = parseFloat(amount); // Use float parse

    if (unstakeAmount <= 0) return { success: false, message: "Unstake amount must be positive." };
    if ((state.accounts[userId].staked || 0) < unstakeAmount) return { success: false, message: "Insufficient staked tokens." };

    state.accounts[userId].staked -= unstakeAmount;
    state.accounts[userId].tokenBalance += unstakeAmount;
    
    const tx = { type: "UNSTAKE", from: userId, amount: unstakeAmount, time: nowSec() };
    state.pendingTips.push(tx); 
    
    await saveState(state);
    uiUpdateCallback();
    return { success: true, message: `Unstaked ${unstakeAmount.toLocaleString()} tokens.` };
}

export async function getChainHistory() {
    const state = await getState();
    return state.chain.slice(-10).reverse(); // Return last 10 blocks
}

// --- BOOTSTRAP ---

let lastCycleTime = nowSec();

async function minuteTimer() {
    const now = nowSec();
    // Use blockIntervalSec to trigger expensive operations
    const state = await getState();
    const interval = state.config.blockIntervalSec;
    
    if (now - lastCycleTime >= interval) {
        lastCycleTime = now - (now % interval); // Align to the interval boundary
        console.log("Running minute cycle...");
        await finalizeBlock();
        await runMinuteCycle();
    }
    uiUpdateCallback(); 
}

// Function to handle initial load and subscription
async function initializeAndSubscribeState(currentUser, creator) {
    
    // 1. Initial Load (using getState logic)
    const initialState = await getState(); 
    stateCache = initialState;

    let needsSave = false;
    // Set the dev handle to the actual creator if not already set or defaulted.
    if (!stateCache.config.genesisInitialized && stateCache.config.devHandle === DEFAULT_CONFIG.devHandle) {
        stateCache.config.devHandle = `@${creator.username}`;
        needsSave = true;
    }
    
    // Store current user handle for UI reference
    if (stateCache.config.currentUserHandle !== currentUser.username) {
        stateCache.config.currentUserHandle = currentUser.username;
        needsSave = true;
    }

    // Save updated config immediately if it changed during initial load
    if (needsSave) {
        await saveState(stateCache);
    }
    
    // 2. Set up real-time subscription for the state record(s)
    const handleStateUpdate = (records) => {
        if (records && records.length > 0) {
            const record = records[0]; 
            
            // Optimization: check if the data actually changed (optional, but good practice)
            const newChainLength = record.chain?.length || 0;
            const currentChainLength = stateCache?.chain?.length || 0;

            const isNewRecord = record.id !== stateRecordId;
            
            if (isNewRecord || newChainLength !== currentChainLength) {
                stateRecordId = record.id;
                
                // Rehydrate stateCache from the record
                const newConfig = record.config || DEFAULT_CONFIG;
                stateCache = {
                    config: newConfig,
                    chain: record.chain || [],
                    accounts: record.accounts || {},
                    pendingTips: record.pendingTips || [],
                    autoencoderState: record.autoencoderState || {},
                };
                // Trigger UI update immediately upon receiving remote data change
                uiUpdateCallback();
            }
        } 
    };

    // Subscribe to all records of this type. Since we aim for only one record, this works.
    room.collection(COLLECTION_TYPE).subscribe(handleStateUpdate);
}


async function boot() {
  // Fetch current user and project creator for initial config setup
  const currentUser = await window.websim.getCurrentUser();
  const creator = await window.websim.getCreator();
  
  await initializeAndSubscribeState(currentUser, creator);
  
  // Hook up listeners for real-time comment creation
  window.websim.addEventListener('comment:created', async (data) => {
    const comment = data.comment;
    
    // Ignore auto tags to prevent infinite loop
    if (comment.raw_content && comment.raw_content.startsWith('[AUTO')) return;
    
    const tipData = {
      id: comment.id,
      author: comment.author.username,
      handle: comment.author.username,
      content: comment.raw_content,
      // Check card_data for credits_spent if it was a tip
      credits: comment.card_data && comment.card_data.type === 'tip_comment' ? comment.card_data.credits_spent : 0
    };
    
    if (tipData.credits > 0) {
        await handleIncomingComment(tipData);
    }
    uiUpdateCallback(); 
  });

  // Main timer loop (runs every second)
  setInterval(minuteTimer, 1000);
}

// Run bootstrap process
boot();