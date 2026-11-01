export type ProteinRepresentation = "cartoon" | "stick" | "surface" | "spacefill" | "backbone" | "line";
export type ProteinPalette = "secondary" | "chain" | "uniform" | "element" | "sequence" | "hydrophobicity";
export type ProteinStyle = { mode: ProteinRepresentation; palette: ProteinPalette; color?: string; opacity?: number };
// studio and clear are page-only looks (the home stage); the Agent's scene tool offers the first three of each.
export type ProteinPresentation = { preset: "standard" | "illustration" | "soft" | "studio"; background: "theme" | "light" | "dark" | "clear" };
export type MolStructureInfo = {
  chains: Array<{ id: string; residues: Array<{ id: string; name: string; code: string }> }>;
  polymer_residues: number; water_residues: number; ligand_residues: number;
};
export type ViewerTheme = { background: number; dark: boolean };
export type MolSelection =
	| { kind: "all" | "polymer" | "water" }
	| { kind: "ligand"; name?: string }
	| { kind: "chain"; chain: string }
	| { kind: "residue"; chain: string; residue: string }
	| { kind: "range"; chain: string; start: string; end: string }
	| { kind: "atom"; chain: string; residue: string; atom: string }
	| { kind: "within"; of: MolSelection; distance: number; include_water?: boolean };
export type MolSceneOperation = {
	id: string;
	op:
		| "representation.upsert" | "representation.remove" | "visibility.set"
		| "selection.set" | "selection.clear" | "camera.fit" | "camera.reset"
		| "camera.set" | "camera.zoom" | "camera.spin" | "water.set" | "measurement.add"
		| "measurement.remove" | "measurement.clear" | "snapshot" | "style.set" | "presentation.set";
  // Display-only operations also use correlated scene receipts.
  presentation?: ProteinPresentation;
	// camera.set: a camera read earlier from the scene state. The page uses it; the Agent's tool does not offer it.
	camera?: { position: number[]; target: number[]; up: number[]; radius: number };
	layer_id?: string;
	selection?: MolSelection;
	mode?: ProteinRepresentation;
	palette?: ProteinPalette;
	color?: string;
	opacity?: number;
	visible?: boolean;
	focus?: boolean;
	factor?: number;
	enabled?: boolean;
	speed?: number;
	kind?: "distance" | "angle" | "dihedral";
	points?: MolSelection[];
};
export type MolSceneState = {
  assets?: Array<{ id: string; version: string; atoms: number }>;
  camera?: { position: number[]; target: number[]; up: number[]; radius: number };
  base_style?: ProteinStyle;
  presentation?: ProteinPresentation;
  local_styles?: Array<{ chain: string; residue: string; mode: ProteinRepresentation; palette: ProteinPalette }>;
	asset_id: string;
	asset_version: string;
	revision: number;
	atoms: number;
	selection: (MolSelection & { atoms: number }) | null;
	representations: Array<{
		layer_id: string;
		selection: MolSelection;
		mode: ProteinRepresentation;
		palette: ProteinPalette;
		color?: string;
		opacity: number;
		visible: boolean;
		atoms: number;
	}>;
	builtin_visible: boolean;
	water_visible: boolean;
	spinning: boolean;
	measurements: Array<{
		layer_id: string;
		kind: "distance" | "angle" | "dihedral";
		points: MolSelection[];
    value?: number; unit?: string;
	}>;
};
export type MolSceneStepReceipt = {
  value?: number; unit?: string;
	id: string;
	status: "applied" | "not_found" | "failed" | "skipped";
	message?: string;
	atoms?: number;
	captured?: boolean;
};
export type MolSceneReceipt = {
	type: "scene-receipt";
	id: string;
	assetId: string;
	assetVersion: string;
	status: "success" | "partial" | "error" | "conflict";
	steps?: MolSceneStepReceipt[];
	state?: MolSceneState;
	error?: string;
};
export type ResidueTarget = { chain: string; residue: string | null };
export type ViewOperation = ResidueTarget & { type: "view"; id: string; assetId: string; assetVersion: string; mode: ProteinRepresentation; palette: ProteinPalette; focus: boolean };
export type ViewState = ResidueTarget & { mode: ProteinRepresentation; palette: ProteinPalette; atoms: number };
export type ViewReceipt = { type: "receipt"; id: string; assetId: string; assetVersion: string; status: "applied" | "not-found" | "failed" | "cancelled"; message?: string; state?: ViewState };
export type WorkspaceSnapshot = { pinned: boolean; pending: ViewOperation[]; active: ViewOperation | null; receipt: ViewReceipt | null; confirmed: ViewReceipt | null };
export function isViewOperation(value: unknown): value is ViewOperation;
export function createProteinWorkspace(options: { send: (command: ViewOperation) => void; timeoutMs?: number }): {
	getSnapshot(): WorkspaceSnapshot;
	subscribe(listener: () => void): () => void;
	request(command: ViewOperation): Promise<ViewReceipt>;
	receive(receipt: ViewReceipt): void;
	setPinned(pinned: boolean): void;
	applyPending(id: string): void;
	dismiss(id: string): void;
	clear(): void;
	dispose(): void;
};
export type ViewerCommand =
  | { type: "hello" }
  | { type: "get-info" }
  | { type: "asset-activate"; assetId: string }
  | { type: "asset-visibility"; assetId: string; visible: boolean }
  | { type: "restore-state"; id: string; expectedRevision: number; state: MolSceneState }
	| ViewOperation
	| ({ type: "load"; append?: boolean; keepCamera?: boolean; content: string; format: "pdb" | "cif" | "sdf"; assetId?: string; assetVersion?: string } & ViewerTheme)
	| ({ type: "theme" } & ViewerTheme)
	| { type: "scene"; id: string; assetId: string; assetVersion: string; expectedRevision?: number; onError: "stop" | "continue"; operations: MolSceneOperation[] }
	| { type: "get-state"; id: string; assetId: string; assetVersion: string }
	| ({
			type: "style";
			mode: ProteinRepresentation;
			palette: ProteinPalette;
	  } & ResidueTarget)
	| ({ type: "select"; focus?: boolean } & ResidueTarget)
	| { type: "reset" | "rotate" | "snapshot" | "clear-local-styles" }
	| { type: "zoom"; factor: 0.8 | 1.25 }
	| { type: "visibility" | "water"; visible: boolean };
export type ViewerEvent =
  | { type: "booted" }
  | { type: "structure-info"; assetId: string; assetVersion: string; info: MolStructureInfo }
  | { type: "scene-changed"; state: MolSceneState }
	| ViewReceipt
	| MolSceneReceipt
	| { type: "ready"; atoms: number; engine: "molstar"; version: string; assetId?: string; assetVersion?: string }
	| ({
			type: "selected";
			atoms: number;
			mode: ProteinRepresentation;
			palette: ProteinPalette;
	  } & ResidueTarget)
	| { type: "pick"; chain: string; residue: string }
	| { type: "interaction" | "clear-selection" }
	| { type: "error"; message: string; fatal?: boolean; command?: string }
	| { type: "snapshot"; data: string };
/** Send hello after iframe load; booted confirms the command listener is installed. */
export function sendViewerCommand(
	frame: HTMLIFrameElement | null,
	command: ViewerCommand,
): void;
/** Subscribe once per mounted iframe. Returns the listener cleanup. */
export function subscribeViewer(
	frame: HTMLIFrameElement,
	receive: (event: ViewerEvent) => void,
): () => void;
