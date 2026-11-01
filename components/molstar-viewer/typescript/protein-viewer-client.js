const channel = "evo-protein";
export { createProteinWorkspace, isViewOperation } from './protein-workspace.js';
const modes = new Set(["cartoon", "stick", "surface", "spacefill", "backbone", "line"]);
const palettes = new Set(["secondary", "chain", "uniform", "element", "sequence", "hydrophobicity"]);
function isViewerEvent(event) {
	if (!event || event.channel !== channel) return false;
	switch (event.type) {
    case "booted": return true;
    case "structure-info": return typeof event.assetId === "string" && typeof event.assetVersion === "string" && Array.isArray(event.info?.chains);
    case "scene-changed": return event.state && typeof event.state.asset_id === "string" && Number.isInteger(event.state.revision) && Number.isFinite(event.state.atoms);
		case "scene-receipt":
			return typeof event.id === "string" && typeof event.assetId === "string" && typeof event.assetVersion === "string"
				&& ["success", "partial", "error", "conflict"].includes(event.status)
				&& (event.steps === undefined || Array.isArray(event.steps))
				&& (event.state === undefined || (Number.isInteger(event.state.revision) && Number.isFinite(event.state.atoms)));
		case "receipt":
			return typeof event.id === "string" && typeof event.assetId === "string" && typeof event.assetVersion === "string"
				&& ["applied", "not-found", "failed"].includes(event.status)
				&& (event.status !== "applied" || (event.state && Number.isFinite(event.state.atoms) && typeof event.state.chain === "string"
					&& (event.state.residue === null || typeof event.state.residue === "string") && modes.has(event.state.mode) && palettes.has(event.state.palette)));
		case "interaction":
		case "clear-selection":
			return true;
		case "ready":
			return (
				Number.isFinite(event.atoms) &&
				event.engine === "molstar" &&
				typeof event.version === "string"
			);
		case "selected":
			return (
				Number.isFinite(event.atoms) &&
				typeof event.chain === "string" &&
				(event.residue === null || typeof event.residue === "string") &&
				modes.has(event.mode) &&
				palettes.has(event.palette)
			);
		case "pick":
			return (
				typeof event.chain === "string" && typeof event.residue === "string"
			);
		case "error":
			return typeof event.message === "string";
		case "snapshot":
			return (
				typeof event.data === "string" &&
				event.data.startsWith("data:image/png;base64,")
			);
		default:
			return false;
	}
}
export function sendViewerCommand(frame, command) {
	// Opaque-origin sandbox requires '*'; the subscriber verifies the exact window.
	frame?.contentWindow?.postMessage({ ...command, channel }, "*");
}
export function subscribeViewer(frame, receive) {
	const listener = (event) => {
		if (event.source === frame.contentWindow && isViewerEvent(event.data))
			receive(event.data);
	};
	window.addEventListener("message", listener);
	return () => window.removeEventListener("message", listener);
}
