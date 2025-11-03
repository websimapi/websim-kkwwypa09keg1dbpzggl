import * as Blockchain from 'blockchain';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

// --- UTILS ---

const tokenFormatter = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
});

function formatTokens(n) {
    if (typeof n !== 'number' || isNaN(n)) return '0.00';
    // Truncate to 2 decimal places before formatting, ensuring we only display accrued value (no rounding up)
    const truncated = Math.floor(n * 100) / 100;
    return tokenFormatter.format(truncated);
}

function TerminalLog({ log }) {
    const messages = log.messages.map((msg, index) => 
        React.createElement('p', { 
            key: index, 
            style: { margin: '3px 0', color: msg.color || 'var(--color-text)' } 
        }, `[${new Date().toLocaleTimeString('en-US', { hour12: false })}] > ${msg.text}`)
    );

    return React.createElement('div', { className: 'section hologram-card' }, 
        React.createElement('h2', null, 'ACTIVITY LOG'),
        React.createElement('div', { style: { maxHeight: '200px', overflowY: 'scroll', fontSize: '0.9em' } }, messages)
    );
}

function AccountStatus({ account, isDev }) {
    const tokenBalance = account.tokenBalance || 0;
    const staked = account.staked || 0;

    const devStatus = isDev 
        ? React.createElement('span', { style: { color: 'var(--color-secondary)' } }, '// DEV PRIMARY NODE //')
        : null;

    return React.createElement('div', { className: 'account-info' },
        React.createElement('div', null,
            React.createElement('strong', null, `NODE: ${account.display}`),
            ' ',
            devStatus
        ),
        React.createElement('div', null,
            React.createElement('span', { style: { color: 'var(--color-primary)' } }, 'TOKEN BALANCE:'),
            ` ${formatTokens(tokenBalance)} TK`
        ),
        React.createElement('div', null,
            React.createElement('span', { style: { color: 'var(--color-primary)' } }, 'STAKED WEIGHT:'),
            ` ${formatTokens(staked)} TK`
        )
    );
}

function TokenomicsInfographic({ config, totals }) {
    const { devSplit, creditToToken } = config;

    const tokenomicsHtml = `
This Genesis protocol uses Tip-as-Block Consensus to issue network tokens (TK).

1. **Minting Trigger**: Tipping the project via \`websim.postComment()\` (min 10 ♦ credits).

2. **Minting Rate**: 1 ♦ Credit tip mints **${creditToToken.toLocaleString()} TK**.

3. **Developer Split**: **${(devSplit * 100).toFixed(0)}%** of minted tokens go directly to the Developer Node (${config.devHandle}).

4. **Reward Pool**: The remaining **${((1 - devSplit) * 100).toFixed(0)}%** is credited to the Tipper and contributes to Staking Rewards.

5. **Staking Payouts**: Staked TK earns rewards every ${config.blockIntervalSec} seconds (1 minute), based on Autoencoder activity. Est. APY: **${totals.currentRate}%**.
`;

    return React.createElement('div', { className: 'section hologram-card' },
        React.createElement('h2', null, 'GENESIS PROTOCOL'),
        React.createElement('div', { dangerouslySetInnerHTML: { __html: DOMPurify.sanitize(marked.parse(tokenomicsHtml)) } })
    );
}

function Dashboard({ state, totals, currentAccount, addLogMessage }) {
    const { config } = state;

    // --- State Management for Interactions ---
    const [tipAmount, setTipAmount] = useState(10);
    const [tipContent, setTipContent] = useState('Transaction initiation.');
    const [stakeAmount, setStakeAmount] = useState(100);
    const [unstakeAmount, setUnstakeAmount] = useState(100);
    const [isProcessing, setIsProcessing] = useState(false);

    const isGenesisInitialized = config.genesisInitialized;
    const currentUserHandle = config.currentUserHandle;
    const devHandle = config.devHandle.replace('@', '');
    const isDev = currentUserHandle === devHandle;

    // --- Actions ---
    const handleTip = async () => {
        setIsProcessing(true);
        addLogMessage('Initiating Tip TX via WebSim API...', 'var(--color-secondary)');
        const result = await Blockchain.postUserTip(tipContent, tipAmount);
        if (result.success) {
            addLogMessage(`Tip initiated successfully. Please approve the tip in the WebSim prompt to finalize minting.`, 'var(--color-text)');
        } else {
            addLogMessage(`Tip Failed: ${result.message}`, 'red');
        }
        // WebSim returns immediately, actual minting happens on comment:created event.
        setIsProcessing(false);
    };

    const handleStake = async () => {
        setIsProcessing(true);
        addLogMessage(`Attempting to stake ${stakeAmount} TK...`, 'var(--color-secondary)');
        const result = await Blockchain.stakeTokens(currentUserHandle, stakeAmount);
        if (result.success) {
            addLogMessage(result.message, 'var(--color-text)');
            setStakeAmount(100);
        } else {
            addLogMessage(`Stake Failed: ${result.message}`, 'red');
        }
        setIsProcessing(false);
    };

    const handleUnstake = async () => {
        setIsProcessing(true);
        addLogMessage(`Attempting to unstake ${unstakeAmount} TK...`, 'var(--color-secondary)');
        const result = await Blockchain.unstakeTokens(currentUserHandle, unstakeAmount);
        if (result.success) {
            addLogMessage(result.message, 'var(--color-text)');
            setUnstakeAmount(100);
        } else {
            addLogMessage(`Unstake Failed: ${result.message}`, 'red');
        }
        setIsProcessing(false);
    };
    
    // UI Elements using React.createElement
    
    const renderGenesisWarning = () => {
        if (!isGenesisInitialized && !isDev) {
            return React.createElement('p', { style: { color: 'red' } },
                `Genesis Block Required. Only the Developer Node (${config.devHandle}) can perform the initial tip TX to begin the chain.`
            );
        }
        return null;
    };
    
    // Data Grid Cells
    const dataGridCells = [
        ['NETWORK STATUS', isGenesisInitialized ? 'ONLINE' : 'PENDING GENESIS'],
        ['NEXT REWARD CYCLE IN', `${totals.nextCycleSecs}s`],
        ['TOTAL SUPPLY (TK)', formatTokens(totals.totalSupply)],
        ['TOTAL STAKED (TK)', formatTokens(totals.totalStaked)]
    ].map(([label, value], index) => 
        React.createElement('div', { key: index, className: 'data-cell' },
            React.createElement('span', null, label),
            value
        )
    );
    
    // Tip Controls
    const tipInput = React.createElement('input', {
        type: "number",
        min: "10",
        value: tipAmount,
        onChange: (e) => setTipAmount(parseInt(e.target.value) || 10),
        className: "terminal-input",
        style: { width: '80px' },
        disabled: isProcessing
    });

    const tipContentInput = React.createElement('input', {
        type: "text",
        value: tipContent,
        onChange: (e) => setTipContent(e.target.value),
        className: "terminal-input",
        placeholder: "Transaction content/message...",
        style: { flexGrow: 1 },
        disabled: isProcessing
    });

    const tipButton = React.createElement('button', {
        onClick: handleTip,
        disabled: isProcessing || tipAmount < 10 || (!isGenesisInitialized && !isDev && tipAmount < 10)
    }, 'MINT/TIP');

    // Stake Controls
    const stakeInput = React.createElement('input', {
        type: "number",
        min: "1",
        value: stakeAmount,
        onChange: (e) => setStakeAmount(parseFloat(e.target.value) || 1),
        className: "terminal-input",
        style: { width: '120px' },
        disabled: isProcessing
    });

    const stakeButton = React.createElement('button', {
        onClick: handleStake,
        disabled: isProcessing || stakeAmount < 1 || currentAccount.tokenBalance < stakeAmount
    }, 'STAKE TK');

    const unstakeInput = React.createElement('input', {
        type: "number",
        min: "1",
        value: unstakeAmount,
        onChange: (e) => setUnstakeAmount(parseFloat(e.target.value) || 1),
        className: "terminal-input",
        style: { width: '120px' },
        disabled: isProcessing
    });

    const unstakeButton = React.createElement('button', {
        onClick: handleUnstake,
        disabled: isProcessing || unstakeAmount < 1 || currentAccount.staked < unstakeAmount
    }, 'UNSTAKE TK');


    return React.createElement('div', { className: 'section' },
        React.createElement('h2', null, 'NETWORK INTERFACE'),
        React.createElement(AccountStatus, { account: currentAccount, isDev: isDev }),
        React.createElement('br', null),

        React.createElement('div', { className: 'data-grid' }, dataGridCells),

        React.createElement('h3', { style: { marginTop: '20px' } }, '[TX: MINT] Tip and Mint Tokens'),
        renderGenesisWarning(),
        React.createElement('div', { className: 'tip-control' },
            tipInput,
            React.createElement('label', null, '♦ Credits (Min 10)'),
            tipContentInput,
            tipButton
        ),

        React.createElement('h3', { style: { marginTop: '20px' } }, '[TX: STAKE] Staking Operations (Passive Income)'),
        React.createElement('div', { className: 'stake-control' },
            stakeInput,
            stakeButton,
            unstakeInput,
            unstakeButton
        )
    );
}

function ChainHistory({ chain }) {
    const [history, setHistory] = useState([]);

    const fetchHistory = useCallback(async () => {
        const h = await Blockchain.getChainHistory();
        setHistory(h);
    }, []);

    useEffect(() => {
        // Since the UI callback is triggered often, we rely on React to fetch when state changes are detected
        fetchHistory();
    }, [chain, fetchHistory]);

    const historyList = history.map(block => {
        const txList = block.txs.map((tx, idx) => 
            React.createElement('li', {
                key: idx,
                style: {
                    color: tx.type === 'TIP' ? 'var(--color-text)' : (tx.type === 'REWARD' ? 'var(--color-primary)' : 'var(--color-secondary)')
                }
            }, 
                `${tx.type}: ${tx.from || 'System'} | Tokens: ${formatTokens(tx.mintTokens || tx.amount || tx.tokenReward || 0)}`
            )
        );

        return React.createElement('div', { key: block.index, className: 'hologram-card', style: { padding: '8px', marginBottom: '10px' } },
            React.createElement('strong', { style: { color: 'var(--color-primary)' } }, 
                `BLOCK #${block.index} [TS:${new Date(block.timestamp * 1000).toLocaleTimeString()}]`
            ),
            ` (TXs: ${block.txs.length})`,
            React.createElement('br', null),
            React.createElement('small', null, `HASH: ${block.blockHash.substring(0, 15)}...`),
            React.createElement('ul', { style: { listStyleType: 'none', paddingLeft: '0', fontSize: '0.8em', marginTop: '5px' } }, txList)
        );
    });

    return React.createElement('div', { className: 'section' },
        React.createElement('h2', null, 'BLOCKCHAIN LEDGER (Last 10 Blocks)'),
        React.createElement('div', { style: { maxHeight: '300px', overflowY: 'scroll' } }, historyList)
    );
}

function App() {
    const [state, setState] = useState(null);
    const [logMessages, setLogMessages] = useState([]);

    // Function to update state and UI
    const updateState = useCallback(async () => {
        try {
            const newState = await Blockchain.getCurrentState();
            setState(newState);
        } catch(e) {
            console.error("Error refreshing state:", e);
        }
    }, []);

    // Function to handle logging messages
    const addLogMessage = useCallback((text, color) => {
        setLogMessages(prev => [{ text, color }, ...prev].slice(0, 20)); // Keep last 20 messages
    }, []);

    useEffect(() => {
        // Set the callback in the blockchain module
        Blockchain.setUIUpdateCallback(updateState);

        // Initial load state is handled by the initial call in boot, 
        // we ensure an immediate refresh here if state is null.
        if (!state) updateState();

    }, [updateState]);

    if (!state) {
        return React.createElement('h1', { className: 'title-bar' }, 'LOADING GENESIS AUTOCRYPT ENGINE...');
    }

    const currentUserHandle = state.config.currentUserHandle;
    const currentAccount = state.accounts[currentUserHandle] || { display: currentUserHandle, tokenBalance: 0, staked: 0 };

    const activityLog = React.createElement(TerminalLog, { log: { title: "ACTIVITY LOG", messages: logMessages } });
    const chainHistory = React.createElement(ChainHistory, { chain: state.chain });

    return React.createElement('div', { className: 'hologram-effect' },
        React.createElement('div', { className: 'title-bar' },
            React.createElement('h1', null, 'XZYORBITZ // GENESIS AUTOCRYPT ENGINE V1.1'),
            React.createElement('p', { style: { color: 'var(--color-secondary)' } }, 
                `PROTOCOL ACTIVE: ${state.config.genesisInitialized ? 'CHAIN OPERATIONAL' : 'AWAITING GENESIS TIP'}`
            )
        ),

        React.createElement(TokenomicsInfographic, { config: state.config, totals: state.totals }),

        React.createElement(Dashboard, {
            state: state, 
            totals: state.totals, 
            currentAccount: currentAccount, 
            addLogMessage: addLogMessage
        }),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' } },
            activityLog,
            chainHistory
        )
    );
}

// Render the application immediately since this file is now the entry point
const container = document.getElementById('root');
if (container) {
    createRoot(container).render(React.createElement(App));
}