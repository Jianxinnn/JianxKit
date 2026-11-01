const modes = new Set(['cartoon', 'stick', 'surface', 'spacefill', 'backbone', 'line']);
const palettes = new Set(['secondary', 'chain', 'uniform', 'element', 'sequence', 'hydrophobicity']);
const signature = value => JSON.stringify([value.type, value.id, value.assetId, value.assetVersion, value.chain, value.residue, value.mode, value.palette, value.focus]);
export function isViewOperation(value) {
	return !!value && value.type === 'view' && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 256
		&& typeof value.assetId === 'string' && value.assetId.length > 0 && typeof value.assetVersion === 'string' && value.assetVersion.length > 0
		&& typeof value.chain === 'string' && value.chain.length <= 8
		&& (value.residue === null || (typeof value.residue === 'string' && /^-?\d+[A-Za-z]?$/.test(value.residue)))
		&& modes.has(value.mode) && palettes.has(value.palette) && typeof value.focus === 'boolean';
}

/** Framework-independent arbitration. send() must deliver to exactly one viewer. */
export function createProteinWorkspace({ send, timeoutMs = 20000 }) {
	let state = { pinned: false, pending: [], active: null, receipt: null, confirmed: null };
	let disposed = false, timer;
	const listeners = new Set(), requests = new Map();
	const publish = patch => {
		state = { ...state, ...patch };
		for (const listener of listeners) listener();
	};
	function finish(receipt) {
		const entry = requests.get(receipt.id);
		if (!entry || entry.receipt) return;
		entry.receipt = receipt;
		entry.resolve(receipt);
		if (state.active?.id === receipt.id) {
			clearTimeout(timer);
			publish({ active: null, receipt, confirmed: receipt.status === 'applied' ? receipt : state.confirmed });
		} else publish({ pending: state.pending.filter(item => item.id !== receipt.id), receipt });
	}
	function drain(force = false) {
		if (disposed || (state.pinned && !force) || state.active || !state.pending.length) return;
		const [command, ...pending] = state.pending;
		publish({ active: command, pending });
		timer = setTimeout(() => {
			// A timeout is uncertain: do not send another command into a stalled viewer.
			publish({ pinned: true });
			finish({ type: 'receipt', id: command.id, assetId: command.assetId, assetVersion: command.assetVersion, status: 'failed', message: 'Viewer did not acknowledge the operation in time' });
		}, timeoutMs);
		try { send(command); } catch (error) {
			finish({ type: 'receipt', id: command.id, assetId: command.assetId, assetVersion: command.assetVersion, status: 'failed', message: String(error) });
			drain();
		}
	}
	return {
		getSnapshot: () => state,
		subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
		request(command) {
			if (disposed) throw Error('Workspace disposed');
			if (!isViewOperation(command)) throw Error('Invalid view operation');
			const existing = requests.get(command.id);
			if (existing) {
				if (signature(existing.command) !== signature(command)) throw Error('Operation ID already belongs to another command');
				return existing.promise;
			}
			let resolve;
			const promise = new Promise(done => { resolve = done; });
			requests.set(command.id, { command: { ...command }, promise, resolve });
			publish({ pending: [...state.pending, { ...command }] });
			drain();
			return promise;
		},
		receive(receipt) {
			const command = state.active;
			if (receipt.type !== 'receipt' || !command || receipt.id !== command.id || receipt.assetId !== command.assetId || receipt.assetVersion !== command.assetVersion) return;
			if (!['applied', 'not-found', 'failed'].includes(receipt.status)) return;
			if (receipt.status === 'applied' && (!receipt.state || receipt.state.chain !== command.chain || receipt.state.residue !== command.residue || receipt.state.mode !== command.mode || receipt.state.palette !== command.palette || !Number.isFinite(receipt.state.atoms) || receipt.state.atoms <= 0)) return;
			finish(receipt);
			drain();
		},
		setPinned(pinned) { publish({ pinned }); drain(); },
		applyPending(id) {
			if (state.active) return;
			const command = state.pending.find(item => item.id === id);
			if (!command) return;
			// Applying one suggestion keeps the user's pin for subsequent operations.
			publish({ pending: [command, ...state.pending.filter(item => item.id !== id)] });
			drain(true);
		},
		dismiss(id) {
			const command = state.pending.find(item => item.id === id);
			if (command) finish({ type: 'receipt', id, assetId: command.assetId, assetVersion: command.assetVersion, status: 'cancelled', message: 'Dismissed by user' });
		},
		clear() {
			for (const command of [state.active, ...state.pending].filter(Boolean)) finish({ type: 'receipt', id: command.id, assetId: command.assetId, assetVersion: command.assetVersion, status: 'cancelled', message: 'Workspace scope reset' });
			publish({ pinned: true, active: null, pending: [], receipt: null, confirmed: null });
		},
		dispose() {
			disposed = true;
			clearTimeout(timer);
			for (const command of [state.active, ...state.pending].filter(Boolean)) finish({ type: 'receipt', id: command.id, assetId: command.assetId, assetVersion: command.assetVersion, status: 'cancelled', message: 'Workspace closed or scope changed' });
			listeners.clear();
		},
	};
}
