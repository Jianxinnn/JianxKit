// Fixed Mol* commands in an opaque-origin sandbox. No network or arbitrary scripts.
let viewer, plugin, structure, polymer, representation, water, waterComponent, ligandComponent, selection;
let mode = "cartoon",
	palette = "secondary",
	visible = true,
	spinning = false;
let baseStyle = { mode, palette },
	background = 0xf7f7f8,
	dark = false,
	selectedRequest = null;
const localStyles = new Map();
let styledComponents = [],
	styledRepresentations = [];
const layers = new Map(),
	residueIndex = new Map(),
	chainIndex = new Map(),
	atomIndex = new Map(),
	componentIndex = new Map(),
	sceneLayers = new Map(),
	measurements = new Map();
let queue = Promise.resolve();
let assetId = "local", assetVersion = "1";
const viewReceipts = new Map();
const sceneReceipts = new Map();
let sceneRevision = 0,
	sceneSelection = null,
	waterVisible = true;
let presentation = { preset: "standard", background: "theme" };
const loadedAssets = new Map();
function rememberAsset() {
  if (!structure || !assetId) return;
  loadedAssets.set(assetId, { structure, polymer, representation, water, waterComponent, ligandComponent, selection, mode, palette, visible, baseStyle, selectedRequest, styledComponents, styledRepresentations, assetId, assetVersion, sceneRevision, sceneSelection, waterVisible,
    maps: [localStyles, layers, residueIndex, chainIndex, atomIndex, componentIndex, sceneLayers, measurements].map(m => [...m]) });
}
function activateAsset(id) {
  if (id === assetId) return;
  const next = loadedAssets.get(id);
  if (!next) throw Error("Structure is not loaded");
  rememberAsset();
  ({ structure, polymer, representation, water, waterComponent, ligandComponent, selection, mode, palette, visible, baseStyle, selectedRequest, styledComponents, styledRepresentations, assetId, assetVersion, sceneRevision, sceneSelection, waterVisible } = next);
  [localStyles, layers, residueIndex, chainIndex, atomIndex, componentIndex, sceneLayers, measurements].forEach((m, i) => { m.clear(); for (const [key, value] of next.maps[i]) m.set(key, value); });
  if (selection) plugin.managers.interactivity.lociSelects.selectOnly({ loci: selection });
  else plugin.managers.interactivity.lociSelects.deselectAll();
  sceneReceipts.clear(); viewReceipts.clear();
}
const emit = (type, detail = {}) =>
	parent.postMessage({ channel: "evo-protein", type, ...detail }, "*");
window.addEventListener("pointerdown", () => emit("interaction"));
let cameraSaveTimer, reportedCamera = "";
function reportCameraChange() {
  clearTimeout(cameraSaveTimer);
  const id = assetId, version = assetVersion;
  cameraSaveTimer = setTimeout(() => schedule({ type: "camera-changed", assetId: id, assetVersion: version }), 500);
}
window.addEventListener("pointerup", reportCameraChange);
window.addEventListener("wheel", reportCameraChange, { passive: true });
window.addEventListener("wheel", () => emit("interaction"), { passive: true });
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape") { schedule({ type: "select", chain: "", residue: null }); emit("clear-selection"); }
});
// Resize before paint instead of waiting for Mol*'s debounced input event.
// Reassigning even identical canvas dimensions clears the WebGL drawing buffer.
function observeViewportResize() {
	const resize = plugin.handleResize;
	plugin.handleResize = () => {
		const { canvas, pixelScale } = plugin.canvas3dContext;
		const root = plugin.layout.root;
		const width = root.offsetWidth, height = root.offsetHeight;
		if (!width || !height) return;
		const scale = window.devicePixelRatio * pixelScale;
		if (canvas.width === Math.round(width * scale) &&
			canvas.height === Math.round(height * scale) &&
			canvas.style.width === `${width}px` && canvas.style.height === `${height}px`) return;
		resize();
		plugin.canvas3d.handleResize();
		plugin.canvas3d.requestDraw();
		plugin.canvas3d.tick(performance.now());
	};
	const observer = new ResizeObserver(() => plugin.handleResize());
	observer.observe(plugin.layout.root);
	window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
}
function residueAt(unit, element) {
	if (unit.kind !== 0) return null;
	const h = unit.model.atomicHierarchy,
		r = h.residueAtomSegments.index[element],
		c = h.chainAtomSegments.index[element];
	return {
		chain: h.chains.auth_asym_id.value(c),
		residue:
			String(h.residues.auth_seq_id.value(r)) +
			(h.residues.pdbx_PDB_ins_code.value(r) || "").trim(),
	};
}
function addIndex(map, key, unit, index) {
	if (!key) return;
	if (!map.has(key))
		map.set(key, {
			kind: "element-loci",
			structure: structure.obj.data,
			elements: [],
		});
	let entry = map.get(key).elements.find((item) => item.unit === unit);
	if (!entry) {
		entry = { unit, indices: [] };
		map.get(key).elements.push(entry);
	}
	entry.indices.push(index);
}
function finishIndex(map) {
	for (const loci of map.values())
		for (const entry of loci.elements)
			entry.indices = Int32Array.from(entry.indices);
}
function indexResidues() {
	residueIndex.clear();
	chainIndex.clear();
	atomIndex.clear();
	componentIndex.clear();
	for (const unit of structure.obj.data.units) {
		for (let i = 0; i < unit.elements.length; i++) {
			const element = unit.elements[i],
				r = residueAt(unit, element);
			if (!r) continue;
			const hierarchy = unit.model.atomicHierarchy,
				atom = String(
					hierarchy.atoms.auth_atom_id?.value(element) ||
						hierarchy.atoms.label_atom_id.value(element) ||
						"",
				).trim().toUpperCase(),
				component = String(hierarchy.atoms.label_comp_id.value(element) || "").trim();
			addIndex(residueIndex, r.chain + ":" + r.residue, unit, i);
			addIndex(chainIndex, r.chain, unit, i);
			addIndex(atomIndex, r.chain + ":" + r.residue + ":" + atom, unit, i);
			addIndex(componentIndex, component.toUpperCase(), unit, i);
		}
	}
	for (const index of [residueIndex, chainIndex, atomIndex, componentIndex]) finishIndex(index);
}
const residueCodes = { ALA:"A", ARG:"R", ASN:"N", ASP:"D", CYS:"C", GLN:"Q", GLU:"E", GLY:"G", HIS:"H", ILE:"I", LEU:"L", LYS:"K", MET:"M", PHE:"F", PRO:"P", SER:"S", THR:"T", TRP:"W", TYR:"Y", VAL:"V", MSE:"M", SEC:"U", PYL:"O", A:"A", C:"C", G:"G", U:"U", T:"T", DA:"A", DC:"C", DG:"G", DT:"T" };
function structureInfo() {
  const chains = new Map(), seen = new Set();
  let polymer_residues = 0, water_residues = 0, ligand_residues = 0;
  for (const unit of structure.obj.data.units) {
    if (unit.kind !== 0) continue;
    const h = unit.model.atomicHierarchy;
    for (const element of unit.elements) {
      const ri = h.residueAtomSegments.index[element], ci = h.chainAtomSegments.index[element];
      const key = `${unit.model.id}:${ci}:${ri}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entity = unit.model.entities.getEntityIndex(h.chains.label_entity_id.value(ci));
      const type = unit.model.entities.data.type.value(entity);
      if (type === "water") { water_residues++; continue; }
      if (type !== "polymer") { ligand_residues++; continue; }
      const r = residueAt(unit, element), name = h.atoms.label_comp_id.value(element);
      if (!chains.has(r.chain)) chains.set(r.chain, { id: r.chain, residues: [] });
      chains.get(r.chain).residues.push({ id: r.residue, name, code: residueCodes[name] || "X" });
      polymer_residues++;
    }
  }
  return { chains: [...chains.values()], polymer_residues, water_residues, ligand_residues };
}
function reportStructureInfo() {
  if (structure) emit("structure-info", { assetId, assetVersion, info: structureInfo() });
}
function validStyle(style) {
  return style && ["cartoon", "stick", "surface", "spacefill", "backbone", "line"].includes(style.mode)
    && ["secondary", "chain", "uniform", "element", "sequence", "hydrophobicity"].includes(style.palette)
    && (style.opacity === undefined || Number.isFinite(style.opacity) && style.opacity >= 0 && style.opacity <= 1)
    && (style.color === undefined || /^#[0-9a-f]{6}$/i.test(style.color));
}
function validPresentation(value) {
  return value && ["standard", "illustration", "soft", "studio"].includes(value.preset) && ["theme", "light", "dark", "clear"].includes(value.background);
}
// Mol*'s own lighting, put back when a preset other than studio is chosen.
const plainLight = { light: [{ inclination: 150, azimuth: 320, color: 0xffffff, intensity: 0.6 }], ambientColor: 0xffffff, ambientIntensity: 0.4, exposure: 1 };
function applyPresentation() {
  const outline = presentation.preset === "illustration";
  // studio: the look of a rendered still. Large-scale occlusion pools shade in the folds, a key and a rim light
  // model the strands, soft shadows let one part of the chain fall on another, and a faint outline keeps the
  // silhouette against a pale page. Paired with background "clear", the page behind shows through the canvas.
  const studio = presentation.preset === "studio";
  const clear = presentation.background === "clear";
  document.documentElement.classList.toggle("viewer-clear", clear);
  plugin.canvas3d.setProps({
    transparentBackground: clear,
    // Mol*'s own chequerboard stands in for transparency; here the page behind the canvas is the background.
    checkeredTransparentBackground: false,
    camera: { helper: { axes: { name: "off", params: {} } } },
    renderer: {
      backgroundColor: presentation.background === "light" ? 0xf6f7fb : presentation.background === "dark" ? 0x202630 : background,
      ...(studio
        ? { light: [{ inclination: 130, azimuth: 300, color: 0xffffff, intensity: 0.72 }, { inclination: 60, azimuth: 120, color: dark ? 0x9fa8ff : 0xdcd6ff, intensity: 0.28 }], ambientColor: dark ? 0xb8bcff : 0xf2f0ff, ambientIntensity: dark ? 0.36 : 0.5, exposure: dark ? 1.08 : 1.02 }
        : plainLight),
    },
    postprocessing: {
      outline: outline ? { name: "on", params: { scale: 1, threshold: 0.33, color: 0x243044, includeTransparent: true } }
        : studio ? { name: "on", params: { scale: 1, threshold: 0.42, color: dark ? 0x05060c : 0x5a5f7a, includeTransparent: false } }
        : { name: "off", params: {} },
      occlusion: studio
        ? { name: "on", params: { samples: 48, multiScale: { name: "on", params: { levels: [{ radius: 2, bias: 1 }, { radius: 5, bias: 1 }, { radius: 8, bias: 1 }], nearThreshold: 10, farThreshold: 1500 } }, radius: 5, bias: 0.8, blurKernelSize: 15, blurDepthBias: 0.5, resolutionScale: 1, color: dark ? 0x05040f : 0x3a3560, transparentThreshold: 0.4 } }
        : { name: presentation.preset === "soft" ? "on" : "off", params: { samples: 32, radius: 5, bias: 0.8, blurKernelSize: 15, resolutionScale: 1, color: 0x000000 } },
      shadow: studio ? { name: "on", params: { steps: 2, maxDistance: 6, tolerance: 1 } } : { name: "off", params: {} },
    },
  });
}
function lociFor(request) {
	return (
		residueIndex.get(request.chain + ":" + request.residue) || {
			kind: "element-loci",
			structure: structure.obj.data,
			elements: [],
		}
	);
}
function emptyLoci() {
	return {
		kind: "element-loci",
		structure: structure.obj.data,
		elements: [],
	};
}
function componentLoci(component) {
	const L = molstar.lib.structure.StructureElement.Loci;
	return component?.obj?.data
		? L.remap(L.all(component.obj.data), structure.obj.data)
		: emptyLoci();
}
function residueNumber(value) {
	const match = /^(-?\d+)/.exec(String(value));
	return match ? Number.parseInt(match[1], 10) : Number.NaN;
}
function resolveSelection(request) {
	if (!request || !structure) return emptyLoci();
	const L = molstar.lib.structure.StructureElement.Loci;
	switch (request.kind) {
		case "all":
			return L.all(structure.obj.data);
		case "polymer":
			return componentLoci(polymer);
		case "water":
			return componentLoci(waterComponent);
		case "ligand": {
			const ligands = componentLoci(ligandComponent);
			if (!request.name) return ligands;
			return L.intersect(ligands, componentIndex.get(String(request.name).toUpperCase()) || emptyLoci());
		}
		case "chain":
			return chainIndex.get(request.chain) || emptyLoci();
		case "residue":
			return residueIndex.get(request.chain + ":" + request.residue) || emptyLoci();
		case "atom":
			return atomIndex.get(request.chain + ":" + request.residue + ":" + String(request.atom).toUpperCase()) || emptyLoci();
		case "range": {
			let result = emptyLoci();
      const compare = (a, b) => residueNumber(a) - residueNumber(b) || a.localeCompare(b);
      const [minimum, maximum] = compare(request.start, request.end) <= 0 ? [request.start, request.end] : [request.end, request.start];
      for (const [key, loci] of residueIndex) {
        const separator = key.indexOf(":"), chain = key.slice(0, separator), residue = key.slice(separator + 1);
        if (chain === request.chain && compare(residue, minimum) >= 0 && compare(residue, maximum) <= 0) result = L.union(result, loci);
      }
			return result;
		}
		case "within": {
			let result = L.extendToWholeResidues(L.extendToRadius(resolveSelection(request.of), request.distance));
			if (!request.include_water) result = L.subtract(result, componentLoci(waterComponent));
			return result;
		}
		default:
			return emptyLoci();
	}
}
function styleFor(request) {
	return request?.residue
		? localStyles.get(request.chain + ":" + request.residue) || baseStyle
		: baseStyle;
}
function reportSelection() {
	const current = styleFor(selectedRequest);
	emit("selected", {
		chain: selectedRequest?.chain ?? "",
		residue: selectedRequest?.residue ?? null,
		mode: current.mode,
		palette: current.palette,
		atoms: selection
			? molstar.lib.structure.StructureElement.Loci.size(selection)
			: 0,
	});
}
function representationProps(style) {
	const customColor = typeof style.color === "string" && /^#[0-9a-f]{6}$/i.test(style.color)
		? Number.parseInt(style.color.slice(1), 16)
		: dark ? 0xe8e5ef : 0x63748b;
	return {
		type: ({ stick: "ball-and-stick", surface: "molecular-surface", spacefill: "spacefill", backbone: "backbone", line: "line" })[style.mode] || "cartoon",
    color: ({ chain: "chain-id", uniform: "uniform", element: "element-symbol", sequence: "sequence-id", hydrophobicity: "hydrophobicity" })[style.palette] || "secondary-structure",
		colorParams:
			style.palette === "uniform"
				? { value: customColor }
				: style.palette === "secondary"
					? {
							colors: {
								name: "custom",
								params: {
									alphaHelix: 0x7163cc,
									threeTenHelix: 0x7163cc,
									piHelix: 0x7163cc,
									betaStrand: 0x299c91,
									betaTurn: 0xb3aec9,
									coil: 0xb3aec9,
									bend: 0xb3aec9,
									turn: 0xb3aec9,
								},
							},
						}
					: {},
		typeParams:
			style.mode === "stick"
				? { sizeFactor: 0.18, alpha: style.opacity ?? 1 }
				: style.mode === "surface"
					? { alpha: style.opacity ?? 0.88 }
					: { alpha: style.opacity ?? 1 },
	};
}
async function applyStyle() {
	if (!polymer) return;
	const L = molstar.lib.structure.StructureElement.Loci;
	let remainder = L.remap(L.all(polymer.obj.data), structure.obj.data);
	for (const style of localStyles.values())
		remainder = L.subtract(remainder, style.loci);
	const desired = new Map([
		["Whole structure", { ...baseStyle, loci: remainder }],
		...localStyles,
	]);
	for (const [key, style] of desired)
		if (!L.size(style.loci)) desired.delete(key);
	// Keep component and representation refs stable. Mol* updates colors without
	// rebuilding geometry; one transaction prevents intermediate blank frames.
	await plugin.dataTransaction(
		async () => {
			const removal = plugin.build();
			let removed = false;
			for (const [key, layer] of layers)
				if (!desired.has(key)) {
					removal.delete(layer.component.ref);
					layers.delete(key);
					removed = true;
				}
			if (removed) await removal.commit();
			for (const [key, style] of desired) {
				let layer = layers.get(key);
				if (!layer || !L.areEqual(layer.loci, style.loci)) {
					const component =
						await plugin.builders.structure.tryCreateComponentFromExpression(
							structure,
							L.toExpression(style.loci),
							key,
							{ label: key },
						);
					layer = { ...layer, component, loci: style.loci };
					layers.set(key, layer);
				}
			}
			const update = plugin.build();
			let changed = false;
			for (const [key, style] of desired) {
				const layer = layers.get(key);
				const signature = JSON.stringify([style.mode, style.palette, style.color, style.opacity, style.palette === "uniform" && dark]);
				if (layer.signature !== signature) {
					layer.rep =
						plugin.builders.structure.representation.buildRepresentation(
							update,
							layer.component,
							representationProps(style),
							{ tag: "protein-style", initialState: { isHidden: !visible } },
						);
					layer.signature = signature;
					changed = true;
				}
			}
			if (changed) await update.commit();
		},
		{ rethrowErrors: true },
	);
	styledComponents = [...layers.values()].map((layer) => layer.component);
	styledRepresentations = [...layers.values()].map((layer) => layer.rep);
	representation = layers.get("Whole structure")?.rep;
	if (selection)
		plugin.managers.interactivity.lociSelects.selectOnly({ loci: selection });
}
function sceneState() {
	const camera = plugin?.canvas3d?.camera.getSnapshot();
	reportedCamera = JSON.stringify(camera);
	return {
		assets: [...loadedAssets.values()].map(a => ({ id: a.assetId, version: a.assetVersion, atoms: a.structure.obj.data.elementCount })),
		asset_id: assetId,
		asset_version: assetVersion,
		revision: sceneRevision,
		atoms: structure?.obj?.data?.elementCount || 0,
    camera,
    base_style: { ...baseStyle },
    presentation: { ...presentation },
    local_styles: [...localStyles.entries()].map(([key, style]) => { const split = key.lastIndexOf(":"); return { chain: key.slice(0, split), residue: key.slice(split + 1), mode: style.mode, palette: style.palette }; }),
		selection: sceneSelection
			? { ...sceneSelection.request, atoms: sceneSelection.atoms }
			: null,
		representations: [...sceneLayers.entries()].map(([layerId, layer]) => ({
			layer_id: layerId,
			selection: layer.selection,
			mode: layer.mode,
			palette: layer.palette,
			color: layer.color,
			opacity: layer.opacity,
			visible: layer.visible,
			atoms: layer.atoms,
		})),
		builtin_visible: visible,
		water_visible: waterVisible,
		spinning,
		measurements: [...measurements.entries()].map(([layerId, item]) => ({
			layer_id: layerId,
			kind: item.kind,
			points: item.points,
			value: item.value, unit: item.unit,
		})),
	};
}
async function removeSceneLayer(layerId) {
	const layer = sceneLayers.get(layerId);
	if (!layer) return false;
	await plugin.build().delete(layer.component.ref).commit();
	sceneLayers.delete(layerId);
	return true;
}
async function clearSceneLayers() {
	if (!sceneLayers.size) return;
	const update = plugin.build();
	for (const layer of sceneLayers.values()) update.delete(layer.component.ref);
	await update.commit();
	sceneLayers.clear();
}
async function clearMeasurements() {
	if (!measurements.size) return;
	const update = plugin.build();
	for (const item of measurements.values()) update.delete(item.selection.ref);
	await update.commit();
	measurements.clear();
}
function setSpin(enabled, speed = 0.07) {
	spinning = enabled;
	plugin.canvas3d.setProps({
		trackball: {
			animate: spinning
				? { name: "spin", params: { speed, axis: [0, 1, 0] } }
				: { name: "off", params: {} },
		},
	});
}
function zoomCamera(factor) {
	const V = molstar.lib.math.LinearAlgebra.Vec3,
		snapshot = plugin.canvas3d.camera.getSnapshot();
	plugin.canvas3d.camera.setState(
		{
			position: V.scaleAndAdd(
				V(),
				snapshot.target,
				V.sub(V(), snapshot.position, snapshot.target),
				1 / factor,
			),
		},
		0,
	);
}
function cameraSettled() {
	// Mol* applies requested focus/reset on its next render tick. A receipt
	// must describe that camera, not the snapshot from before the click.
	return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
function sceneSphere() {
	const sphere = structure?.obj?.data?.boundary?.sphere;
	return sphere ? { center: [...sphere.center], radius: sphere.radius } : null;
}
// The previous view still frames the new coordinates when both spheres roughly coincide.
function sameFrame(before, after) {
	if (!before || !after || !after.radius) return false;
	const d = Math.hypot(...before.center.map((value, index) => value - after.center[index]));
	return d < 0.35 * after.radius && Math.abs(before.radius - after.radius) < 0.35 * after.radius;
}
function validSceneSelection(value, depth = 0) {
	if (!value || typeof value !== "object" || depth > 3) return false;
	if (["all", "polymer", "water"].includes(value.kind)) return true;
	if (value.kind === "ligand") return value.name === undefined || typeof value.name === "string";
	if (value.kind === "chain") return typeof value.chain === "string" && value.chain.length > 0;
	if (value.kind === "residue") return typeof value.chain === "string" && typeof value.residue === "string";
	if (value.kind === "range") return typeof value.chain === "string" && typeof value.start === "string" && typeof value.end === "string";
	if (value.kind === "atom") return typeof value.chain === "string" && typeof value.residue === "string" && typeof value.atom === "string";
	return value.kind === "within" && Number.isFinite(value.distance) && value.distance > 0 && value.distance <= 30 && validSceneSelection(value.of, depth + 1);
}
function validCamera(camera) {
	return Boolean(camera) && ["position", "target", "up"].every(k => Array.isArray(camera[k]) && camera[k].length === 3 && camera[k].every(Number.isFinite))
		&& Number.isFinite(camera.radius) && camera.radius > 0;
}
function validateSceneOperation(operation) {
  if (operation?.op === "style.set" && !validStyle(operation)) throw Error("Invalid display style");
  if (operation?.op === "presentation.set" && !validPresentation(operation.presentation)) throw Error("Invalid presentation");
	if (!operation || typeof operation.id !== "string" || !operation.id || typeof operation.op !== "string")
		throw Error("Invalid scene operation");
	if (["representation.upsert", "representation.remove", "visibility.set", "measurement.add", "measurement.remove"].includes(operation.op)
		&& (typeof operation.layer_id !== "string" || !operation.layer_id)) throw Error("Layer ID is required");
	if (operation.op === "representation.upsert") {
		if (!validSceneSelection(operation.selection) || !["cartoon", "stick", "surface", "spacefill", "backbone", "line"].includes(operation.mode)
			|| !["secondary", "chain", "uniform", "element", "sequence", "hydrophobicity"].includes(operation.palette)
			|| !Number.isFinite(operation.opacity) || operation.opacity < 0 || operation.opacity > 1
			|| (operation.color !== undefined && !/^#[0-9a-f]{6}$/i.test(operation.color))) throw Error("Invalid representation operation");
	}
	if (["selection.set", "camera.fit"].includes(operation.op) && !validSceneSelection(operation.selection))
		throw Error("Invalid selection");
	if (operation.op === "camera.set" && !validCamera(operation.camera)) throw Error("Invalid camera");
	if (operation.op === "measurement.add") {
		const count = { distance: 2, angle: 3, dihedral: 4 }[operation.kind];
		if (!count || !Array.isArray(operation.points) || operation.points.length !== count || !operation.points.every((point) => validSceneSelection(point)))
			throw Error("Invalid measurement");
	}
}
async function executeSceneOperation(operation) {
	validateSceneOperation(operation);
  if (operation.op === "style.set") {
    baseStyle = { mode: operation.mode, palette: operation.palette, ...(operation.color === undefined ? {} : { color: operation.color }), ...(operation.opacity === undefined ? {} : { opacity: operation.opacity }) };
    mode = baseStyle.mode; palette = baseStyle.palette;
    await applyStyle(); reportSelection(); return { status: "applied" };
  }
  if (operation.op === "presentation.set") {
    presentation = { ...operation.presentation }; applyPresentation(); return { status: "applied" };
  }
	const L = molstar.lib.structure.StructureElement.Loci;
	if (operation.op === "representation.upsert") {
		const loci = resolveSelection(operation.selection), atoms = L.size(loci);
		if (!atoms) return { status: "not_found", message: "Selection has no coordinates" };
		const isVisible = operation.visible !== false;
		let component = sceneLayers.get(operation.layer_id)?.component, rep;
		await plugin.dataTransaction(async () => {
			if (!component || !L.areEqual(componentLoci(component), loci)) {
				component = await plugin.builders.structure.tryCreateComponentFromExpression(
					structure, L.toExpression(loci), "agent-" + operation.layer_id, { label: operation.layer_id },
				);
			}
			if (!component) throw Error("Selection has no coordinates");
			rep = await plugin.builders.structure.representation.addRepresentation(
				component, representationProps(operation),
				{ tag: "agent-layer-" + operation.layer_id, initialState: { isHidden: !isVisible } },
			);
			plugin.state.data.updateCellState(rep.ref, { isHidden: !isVisible });
		}, { rethrowErrors: true });
		sceneLayers.set(operation.layer_id, {
			component, rep, atoms, selection: operation.selection,
			mode: operation.mode, palette: operation.palette, color: operation.color,
			opacity: operation.opacity, visible: isVisible,
		});
		return { status: "applied", atoms };
	}
	if (operation.op === "representation.remove") {
		return await removeSceneLayer(operation.layer_id)
			? { status: "applied" }
			: { status: "not_found", message: "Representation layer does not exist" };
	}
	if (operation.op === "visibility.set") {
		if (typeof operation.visible !== "boolean") throw Error("Visibility is required");
		if (operation.layer_id === "builtin") {
			visible = operation.visible;
			for (const rep of styledRepresentations) plugin.state.data.updateCellState(rep.ref, { isHidden: !visible });
			return { status: "applied" };
		}
		const layer = sceneLayers.get(operation.layer_id);
		if (!layer) return { status: "not_found", message: "Representation layer does not exist" };
		layer.visible = operation.visible;
		plugin.state.data.updateCellState(layer.rep.ref, { isHidden: !layer.visible });
		return { status: "applied" };
	}
	if (operation.op === "selection.set" || operation.op === "camera.fit") {
		const loci = resolveSelection(operation.selection), atoms = L.size(loci);
		if (!atoms) return { status: "not_found", message: "Selection has no coordinates" };
		if (operation.op === "selection.set") {
			selection = loci;
			sceneSelection = { request: operation.selection, atoms };
      selectedRequest = operation.selection.kind === "residue" ? { chain: operation.selection.chain, residue: operation.selection.residue } : null;
      reportSelection();
			plugin.managers.interactivity.lociSelects.selectOnly({ loci });
			if (operation.focus) plugin.managers.camera.focusLoci(loci, { durationMs: 0, minRadius: 5, extraRadius: 4 });
		} else {
			plugin.managers.camera.focusLoci(loci, { durationMs: 0, minRadius: 5, extraRadius: 4 });
		}
		if (operation.focus || operation.op === "camera.fit") await cameraSettled();
		return { status: "applied", atoms };
	}
	if (operation.op === "selection.clear") {
		selection = null;
		sceneSelection = null;
    selectedRequest = null;
		plugin.managers.interactivity.lociSelects.deselectAll();
		return { status: "applied" };
	}
	if (operation.op === "camera.reset") {
		plugin.managers.camera.reset(undefined, 0);
		await cameraSettled();
		return { status: "applied" };
	}
	// A view the page read earlier from the state, put back as it was.
	if (operation.op === "camera.set") {
		const camera = operation.camera, V = molstar.lib.math.LinearAlgebra.Vec3;
		// Applied now, not on the next frame, so the receipt's state is the view it put back.
		plugin.canvas3d.camera.setState({ position: V.create(...camera.position), target: V.create(...camera.target), up: V.create(...camera.up), radius: camera.radius }, 0);
		return { status: "applied" };
	}
	if (operation.op === "camera.zoom") {
		if (!Number.isFinite(operation.factor) || operation.factor < 0.1 || operation.factor > 10) throw Error("Invalid zoom factor");
		zoomCamera(operation.factor);
		return { status: "applied" };
	}
	if (operation.op === "camera.spin") {
		if (typeof operation.enabled !== "boolean") throw Error("Spin state is required");
		setSpin(operation.enabled, operation.speed ?? 0.07);
		return { status: "applied" };
	}
	if (operation.op === "water.set") {
		if (typeof operation.visible !== "boolean") throw Error("Water visibility is required");
		waterVisible = operation.visible;
		if (water) plugin.state.data.updateCellState(water.ref, { isHidden: !waterVisible });
		return { status: "applied" };
	}
	if (operation.op === "measurement.add") {
		const loci = operation.points.map(resolveSelection);
		if (loci.some((item) => !L.size(item))) return { status: "not_found", message: "A measurement point has no coordinates" };
		const old = measurements.get(operation.layer_id);
		if (old) await plugin.build().delete(old.selection.ref).commit();
		const manager = plugin.managers.structure.measurement;
    const V = molstar.lib.math.LinearAlgebra.Vec3, points = loci.map(item => L.getBoundingSphere(item).center);
    const unit = operation.kind === "distance" ? "Å" : "°";
    const value = operation.kind === "distance" ? V.distance(points[0], points[1]) : operation.kind === "angle" ? V.angle(V.sub(V(), points[0], points[1]), V.sub(V(), points[2], points[1])) * 180 / Math.PI : V.dihedralAngle(...points) * 180 / Math.PI;
    if (!Number.isFinite(value)) throw Error("Measurement is undefined for these points");
    const options = { labelParams: { textColor: dark ? 0xffffff : 0x111111, textSize: 1.5, background: true, backgroundColor: dark ? 0x222222 : 0xffffff, backgroundOpacity: 0.85, borderWidth: 0.05 }, customText: `${value.toFixed(3)} ${unit}` };
		const item = operation.kind === "distance"
			? await manager.addDistance(loci[0], loci[1], options)
			: operation.kind === "angle"
				? await manager.addAngle(loci[0], loci[1], loci[2], options)
				: await manager.addDihedral(loci[0], loci[1], loci[2], loci[3], options);
		if (!item) throw Error("Measurement could not be created");
		measurements.set(operation.layer_id, { ...item, kind: operation.kind, points: operation.points, value, unit });
    if (operation.focus) plugin.managers.camera.focusLoci(loci.reduce((combined, next) => L.union(combined, next)), { durationMs: 0, minRadius: 8, extraRadius: 8 });
		return { status: "applied", value, unit };
	}
	if (operation.op === "measurement.remove") {
		const item = measurements.get(operation.layer_id);
		if (!item) return { status: "not_found", message: "Measurement does not exist" };
		await plugin.build().delete(item.selection.ref).commit();
		measurements.delete(operation.layer_id);
		return { status: "applied" };
	}
	if (operation.op === "measurement.clear") {
		await clearMeasurements();
		return { status: "applied" };
	}
	if (operation.op === "snapshot") {
		emit("snapshot", { data: await plugin.helpers.viewportScreenshot.getImageDataUri() });
		return { status: "applied", captured: true };
	}
	throw Error("Unsupported scene operation");
}
async function executeScene(message) {
	const base = { id: message.id, assetId, assetVersion };
	const signature = JSON.stringify(message);
	const previous = sceneReceipts.get(message.id);
	if (previous) {
		emit("scene-receipt", previous.signature === signature ? previous.receipt : { ...base, status: "conflict", error: "Request ID was reused with different arguments" });
		return;
	}
	let receipt;
	try {
		if (!plugin || !structure) throw Error("Viewer is not ready");
		if (message.assetId !== assetId || message.assetVersion !== assetVersion) throw Error("Asset or version does not match the loaded structure");
		if (!Array.isArray(message.operations) || !message.operations.length || message.operations.length > 24) throw Error("Invalid operation batch");
		if (Number.isInteger(message.expectedRevision) && message.expectedRevision !== sceneRevision) {
			receipt = { ...base, status: "conflict", error: "Scene revision changed", state: sceneState(), steps: [] };
		} else {
			const steps = [];
			let changed = false, stopped = false;
			for (const operation of message.operations) {
				if (stopped) {
					steps.push({ id: operation.id, status: "skipped", message: "Skipped after an earlier failure" });
					continue;
				}
				try {
					const result = await executeSceneOperation(operation);
					steps.push({ id: operation.id, ...result });
					if (result.status === "applied" && operation.op !== "snapshot") changed = true;
					if (result.status !== "applied" && message.onError !== "continue") stopped = true;
				} catch (error) {
					steps.push({ id: operation.id, status: "failed", message: error instanceof Error ? error.message : "Operation failed" });
					if (message.onError !== "continue") stopped = true;
				}
			}
			if (changed) sceneRevision++;
			const failed = steps.filter((step) => step.status !== "applied");
			receipt = {
				...base,
				status: failed.length === 0 ? "success" : failed.length === steps.length ? "error" : "partial",
				steps,
				state: sceneState(),
			};
		}
	} catch (error) {
		receipt = { ...base, status: "error", error: error instanceof Error ? error.message : "Scene execution failed" };
	}
	sceneReceipts.set(message.id, { signature, receipt });
	if (sceneReceipts.size > 256) sceneReceipts.delete(sceneReceipts.keys().next().value);
	emit("scene-receipt", receipt);
}
async function executeCore(message) {
  if (message.type === "get-info") { reportStructureInfo(); return; }
  if (message.type === "pick-residue") {
    activateAsset(message.assetId);
    await executeSceneOperation({ id: "pointer-selection", op: "selection.set", selection: { kind: "residue", chain: message.chain, residue: message.residue } });
    sceneRevision++;
    emit("pick", { chain: message.chain, residue: message.residue });
    return;
  }
  if (message.type === "asset-activate") { activateAsset(message.assetId); reportSelection(); return; }
  if (message.type === "asset-visibility") {
    rememberAsset(); const item = loadedAssets.get(message.assetId);
    if (!item || typeof message.visible !== "boolean") throw Error("Unknown structure visibility target");
    const reps = [...item.styledRepresentations, ...item.maps[6].map(([,layer]) => layer.rep), ...item.maps[7].map(([,measurement]) => measurement.representation), ...(item.water ? [item.water] : [])];
    for (const rep of reps) plugin.state.data.updateCellState(rep.ref, { isHidden: !message.visible || (rep === item.water && !item.waterVisible) });
    return;
  }
  if (message.type === "restore-state") { await restoreState(message); return; }
	if (message.type === "view") {
		return executeView(message);
	} else if (message.type === "scene") {
		return executeScene(message);
	} else if (message.type === "get-state") {
		const receipt = !plugin || !structure
			? { id: message.id, assetId, assetVersion, status: "error", error: "Viewer is not ready" }
			: message.assetId !== assetId || message.assetVersion !== assetVersion
				? { id: message.id, assetId, assetVersion, status: "conflict", error: "Asset or version does not match the loaded structure" }
			: { id: message.id, assetId, assetVersion, status: "success", steps: [], state: sceneState() };
		emit("scene-receipt", receipt);
		return;
	} else if (message.type === "load") {
		if (
			typeof message.content !== "string" ||
			message.content.length > 8 * 1024 * 1024 ||
			!["pdb", "cif", "sdf"].includes(message.format)
		)
			throw Error("Unsupported structure input");
		if (
			Number.isInteger(message.background) &&
			message.background >= 0 &&
			message.background <= 0xffffff
		)
			background = message.background;
		dark = message.dark === true;
		if (!viewer) {
			viewer = await molstar.Viewer.create("stage", {
				extensions: [],
				layoutIsExpanded: false,
				layoutShowControls: false,
				layoutShowSequence: false,
				layoutShowLog: false,
				layoutShowLeftPanel: false,
				layoutShowRemoteState: false,
				viewportShowControls: false,
				viewportShowReset: false,
				viewportShowScreenshotControls: false,
				viewportShowExpand: false,
				viewportShowSettings: false,
				viewportShowSelectionMode: false,
				viewportShowAnimation: false,
				viewportShowTrajectoryControls: false,
				// The host owns selection and explicit focus. Mol*'s default click
				// behavior otherwise builds extra surroundings and moves the camera.
				viewportFocusBehavior: "disabled",
				viewportBackgroundColor: "#" + background.toString(16).padStart(6, "0"),
				volumeStreamingDisabled: true,
				allowMajorPerformanceCaveat: true,
			});
			plugin = viewer.plugin;
			observeViewportResize();
			plugin.canvas3d.setProps({
				camera: { manualReset: true },
				renderer: { backgroundColor: background, selectColor: 0xab8fea },
				marking: { selectEdgeColor: 0x9b7cd5 },
			});
			viewer.subscribe(plugin.behaviors.interaction.click, (event) => {
				if (event.button !== 1) return;
				if (event.current.loci.kind === "empty-loci") {
          schedule({ type: "select", chain: "", residue: null });
					emit("clear-selection");
					return;
				}
				if (event.current.loci.kind !== "element-loci") return;
				const loc =
					molstar.lib.structure.StructureElement.Loci.getFirstLocation(
						event.current.loci,
					);
				const r = loc && residueAt(loc.unit, loc.element);
				if (r) {
          const owner = [...loadedAssets.values()].find(a => a.structure.obj.data.models.includes(loc.unit.model));
          schedule({ type: "pick-residue", assetId: owner?.assetId || assetId, ...r });
        }
			});
		}
    // A frame of the same scene (keepCamera) replaces the coordinates but keeps the
    // reader's view and display style; a different scene starts from a fresh view.
    const kept = message.keepCamera === true && !message.append && structure
      ? { camera: plugin.canvas3d.camera.getSnapshot(), sphere: sceneSphere(), mode: baseStyle.mode, palette: baseStyle.palette }
      : null;
    if (message.append && structure) {
      if (loadedAssets.has(message.assetId)) { activateAsset(message.assetId); emit("ready", { atoms: structure.obj.data.elementCount, engine: "molstar", version: molstar.version, assetId, assetVersion }); return; }
      if (loadedAssets.size >= 12) throw Error("At most 12 structures can be displayed together");
      rememberAsset();
    } else { await plugin.clear(); loadedAssets.clear(); }
    mode = kept?.mode ?? "cartoon"; palette = kept?.palette ?? "secondary";
		selection = null;
		selectedRequest = null;
		representation = null;
		water = null;
		waterComponent = null;
		ligandComponent = null;
		localStyles.clear();
		layers.clear();
		residueIndex.clear();
		chainIndex.clear();
		atomIndex.clear();
		componentIndex.clear();
		sceneLayers.clear();
		measurements.clear();
		sceneReceipts.clear();
		sceneRevision = 0;
		sceneSelection = null;
		waterVisible = true;
		visible = true;
		spinning = false;
		styledComponents = [];
		styledRepresentations = [];
		baseStyle = { mode, palette };
		const data = await plugin.builders.data.rawData({
			data: message.content,
			label: "Reference structure",
		});
		const trajectory = await plugin.builders.structure.parseTrajectory(
			data,
			message.format === "cif" ? "mmcif" : message.format,
		);
		const model = await plugin.builders.structure.createModel(trajectory);
		structure = await plugin.builders.structure.createStructure(model);
		if (
			!structure.obj ||
			!structure.obj.data.elementCount ||
			structure.obj.data.elementCount > 50000
		)
			throw Error("No valid supported coordinates");
		indexResidues();
		polymer = await plugin.builders.structure.tryCreateComponentStatic(
			structure,
			"polymer",
		);
		if (!polymer) {
      polymer = await plugin.builders.structure.tryCreateComponentStatic(structure, "all");
      mode = "stick"; palette = "uniform"; baseStyle = { mode, palette };
    }
    if (!polymer) throw Error("No valid coordinates");
		await applyStyle();
		waterComponent = await plugin.builders.structure.tryCreateComponentStatic(
			structure,
			"water",
		);
		if (waterComponent)
			water = await plugin.builders.structure.representation.addRepresentation(
				waterComponent,
				{
					type: "ball-and-stick",
					color: "uniform",
					colorParams: { value: 0xc94c49 },
					typeParams: { sizeFactor: 0.12 },
				},
			);
		ligandComponent = await plugin.builders.structure.tryCreateComponentStatic(
			structure,
			"ligand",
		);
		if (kept && sameFrame(kept.sphere, sceneSphere())) plugin.canvas3d.camera.setState(kept.camera, 0);
		else plugin.managers.camera.reset(undefined, 0);
		assetId = typeof message.assetId === "string" ? message.assetId : "local";
		assetVersion = typeof message.assetVersion === "string" ? message.assetVersion : "1";
		viewReceipts.clear();
    rememberAsset();
    if (!message.append && !kept) presentation = { preset: "standard", background: "theme" };
    applyPresentation();
		await cameraSettled();
		document.getElementById("stage").dataset.ready = "true";
		document.getElementById("stage").dataset.engine = "molstar";
		emit("ready", {
			atoms: structure.obj.data.elementCount,
			engine: "molstar",
			version: molstar.version,
			assetId, assetVersion,
		});
	} else if (!plugin || !structure) {
		return;
	} else if (
		message.type === "theme" &&
		Number.isInteger(message.background) &&
		message.background >= 0 &&
		message.background <= 0xffffff
	) {
		if (background === message.background && dark === (message.dark === true))
			return;
		background = message.background;
		dark = message.dark === true;
		applyPresentation();
		await applyStyle();
	} else if (
		message.type === "style" &&
		["cartoon", "stick", "surface", "spacefill", "backbone", "line"].includes(message.mode) &&
		["secondary", "chain", "uniform", "element", "sequence", "hydrophobicity"].includes(message.palette)
	) {
		mode = message.mode;
		palette = message.palette;
		if (message.residue) {
			const loci = lociFor(message);
			if (!molstar.lib.structure.StructureElement.Loci.size(loci)) return;
			const current = styleFor(message);
			if (current.mode === mode && current.palette === palette) {
				reportSelection();
				return;
			}
			localStyles.set(message.chain + ":" + message.residue, {
				mode,
				palette,
				loci,
			});
		} else {
			if (
				!localStyles.size &&
				baseStyle.mode === mode &&
				baseStyle.palette === palette
			) {
				reportSelection();
				return;
			}
			baseStyle = { mode, palette };
			localStyles.clear();
		}
		await applyStyle();
		reportSelection();
	} else if (message.type === "clear-local-styles") {
		localStyles.clear();
		await applyStyle();
		reportSelection();
	} else if (message.type === "select") {
		if (message.residue === null) {
			selectedRequest = null;
			selection = null;
			plugin.managers.interactivity.lociSelects.deselectAll();
		} else {
			if (
				typeof message.chain !== "string" ||
				message.chain.length > 8 ||
				!/^(-?\d+)([A-Za-z]?)$/.test(message.residue)
			)
				return;
			const nextSelection = lociFor(message);
			if (!molstar.lib.structure.StructureElement.Loci.size(nextSelection))
				throw Error("Selected residue has no coordinates");
			selectedRequest = { chain: message.chain, residue: message.residue };
			selection = nextSelection;
			plugin.managers.interactivity.lociSelects.selectOnly({ loci: selection });
			if (message.focus)
				plugin.managers.camera.focusLoci(selection, {
					durationMs: 160,
					minRadius: 8,
					extraRadius: 8,
				});
		}
		sceneSelection = selection ? { request: { kind: "residue", ...selectedRequest }, atoms: molstar.lib.structure.StructureElement.Loci.size(selection) } : null;
		reportSelection();
	} else if (message.type === "reset") {
		plugin.canvas3d.requestResize();
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
		plugin.managers.camera.reset(undefined, 0);
	} else if (message.type === "rotate") {
		setSpin(!spinning);
	} else if (message.type === "zoom" && [0.8, 1.25].includes(message.factor)) {
		zoomCamera(message.factor);
	} else if (
		message.type === "visibility" &&
		typeof message.visible === "boolean"
	) {
		visible = message.visible;
		for (const rep of styledRepresentations)
			plugin.state.data.updateCellState(rep.ref, { isHidden: !visible });
	} else if (
		message.type === "water" &&
		typeof message.visible === "boolean" &&
		water
	) {
		waterVisible = message.visible;
		plugin.state.data.updateCellState(water.ref, {
			isHidden: !message.visible,
		});
	} else if (message.type === "snapshot") {
		emit("snapshot", {
			data: await plugin.helpers.viewportScreenshot.getImageDataUri(),
		});
	}
}
async function execute(message) {
  if (message.type === "camera-changed") {
    if (structure && message.assetId === assetId && message.assetVersion === assetVersion
      && reportedCamera !== JSON.stringify(plugin.canvas3d.camera.getSnapshot())) {
      sceneRevision++;
      emit("scene-changed", { state: sceneState() });
    }
    return;
  }
  const previousId = assetId;
  const previousRefs = message.type === "load" && message.append && plugin ? new Set(plugin.state.data.cells.keys()) : null;
  try { await executeCore(message); }
  catch (error) {
    if (previousRefs && loadedAssets.has(previousId)) {
      const update = plugin.state.data.build();
      for (const [ref, cell] of plugin.state.data.cells) if (!previousRefs.has(ref) && previousRefs.has(cell.transform.parent)) update.delete(ref);
      await update.commit();
      // activateAsset must not save the incomplete context over a previous asset.
      const previous = loadedAssets.get(previousId); assetId = ""; structure = null;
      activateAsset(previous.assetId);
      emit("scene-changed", { state: sceneState() });
    }
    throw error;
  }
  if (!plugin || !structure) return;
  if (["style", "select", "clear-local-styles", "reset", "rotate", "zoom", "visibility", "water"].includes(message.type)) sceneRevision++;
  if (["load", "asset-activate"].includes(message.type)) reportStructureInfo();
  if (!["get-state", "get-info", "snapshot", "theme"].includes(message.type)) emit("scene-changed", { state: sceneState() });
}
async function restoreState(message) {
  const state = message.state;
  if (!state || state.asset_id !== assetId || state.asset_version !== assetVersion) throw Error("Saved view belongs to another asset version");
  if (message.expectedRevision !== sceneRevision) throw Error("Scene revision changed before restore");
  if (!Array.isArray(state.representations) || state.representations.length > 100 || !Array.isArray(state.measurements) || state.measurements.length > 100 || !Array.isArray(state.local_styles) || state.local_styles.length > 1000) throw Error("Invalid saved view");
  const styles = [state.base_style, ...state.local_styles];
  if (styles.some(style => !validStyle(style))) throw Error("Invalid saved styles");
  if (state.presentation && !validPresentation(state.presentation)) throw Error("Invalid saved presentation");
  const operations = [...state.representations.map(layer => ({ ...layer, id: layer.layer_id, op: "representation.upsert" })), ...state.measurements.map(item => ({ ...item, id: item.layer_id, op: "measurement.add" }))];
  if (state.selection) operations.push({ id: "restore-selection", op: "selection.set", selection: state.selection });
  for (const operation of operations) validateSceneOperation(operation);
  for (const style of state.local_styles) if (!validSceneSelection({ kind: "residue", ...style }) || !molstar.lib.structure.StructureElement.Loci.size(lociFor(style))) throw Error("Saved residue has no coordinates");
  const camera = state.camera;
  if (!validCamera(camera)) throw Error("Invalid saved camera");
  for (const id of [...sceneLayers.keys()]) await removeSceneLayer(id);
  await clearMeasurements(); localStyles.clear();
  baseStyle = { ...state.base_style };
  presentation = state.presentation ? { ...state.presentation } : { preset: "standard", background: "theme" };
  applyPresentation();
  for (const style of state.local_styles) localStyles.set(`${style.chain}:${style.residue}`, { mode: style.mode, palette: style.palette, loci: lociFor(style) });
  visible = state.builtin_visible === true; waterVisible = state.water_visible === true;
  await applyStyle();
  if (water) plugin.state.data.updateCellState(water.ref, { isHidden: !waterVisible });
  await executeSceneOperation({ id: "clear-selection", op: "selection.clear" });
  for (const operation of operations) { const receipt = await executeSceneOperation(operation); if (receipt.status !== "applied") throw Error(receipt.message); }
  plugin.managers.camera.setSnapshot({ position: camera.position, target: camera.target, up: camera.up, radius: camera.radius }, 0);
  setSpin(state.spinning === true); sceneRevision++; reportSelection();
  emit("scene-receipt", { id: message.id, assetId, assetVersion, status: "success", steps: [], state: sceneState() });
}
// One operation, one correlated receipt. Legacy style/select events are never receipts.
async function executeView(message) {
	const receipt = { id: message.id, assetId: message.assetId, assetVersion: message.assetVersion };
	const signature = JSON.stringify([message.id, message.assetId, message.assetVersion, message.chain, message.residue, message.mode, message.palette, message.focus]);
	const previous = viewReceipts.get(message.id);
	if (previous) {
		emit("receipt", previous.signature === signature ? previous.receipt : { ...receipt, status: "failed", message: "Operation ID reused with different arguments" });
		return;
	}
	let result;
	try {
		if (typeof message.id !== "string" || !message.id || message.id.length > 256 || typeof message.chain !== "string" || message.chain.length > 8
			|| (message.residue !== null && (typeof message.residue !== "string" || !/^-?\d+[A-Za-z]?$/.test(message.residue)))
			|| !["cartoon", "stick", "surface", "spacefill", "backbone", "line"].includes(message.mode) || !["secondary", "chain", "uniform", "element", "sequence", "hydrophobicity"].includes(message.palette) || typeof message.focus !== "boolean") throw Error("Invalid view operation");
		if (!structure || !plugin) throw Error("Viewer is not ready");
		if (message.assetId !== assetId || message.assetVersion !== assetVersion) throw Error("Asset or version does not match the loaded structure");
		const loci = message.residue === null ? null : lociFor(message);
		if (loci && !molstar.lib.structure.StructureElement.Loci.size(loci)) {
			result = { ...receipt, status: "not-found", message: "Target residue has no coordinates" };
		} else {
			await execute({ ...message, type: "style" });
			await execute({ ...message, type: "select", focus: false });
			if (message.focus && loci) plugin.managers.camera.focusLoci(loci, { durationMs: 0, minRadius: 8, extraRadius: 8 });
			if (message.focus && !loci) plugin.managers.camera.reset(undefined, 0);
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			result = { ...receipt, status: "applied", state: { chain: message.chain, residue: message.residue, ...styleFor(selectedRequest), atoms: loci ? molstar.lib.structure.StructureElement.Loci.size(loci) : polymer.obj.data.elementCount } };
			// Loci are internal Mol* objects, not part of the serializable state contract.
			delete result.state.loci;
		}
	} catch (error) {
		result = { ...receipt, status: "failed", message: error instanceof Error ? error.message : "View operation failed" };
	}
	viewReceipts.set(message.id, { signature, receipt: result });
	if (viewReceipts.size > 256) viewReceipts.delete(viewReceipts.keys().next().value);
	// Send a browser execution receipt, not a scientific result or server persistence claim.
	emit("receipt", result);
}
// Coalesce only adjacent pending commands with identical scope. Never cross a
// load, snapshot, reset, or a different style target: those are ordering barriers.
// Frame loads (keepCamera) replace each other: only the newest frame is worth building.
const pending = [];
let drainTimer = null;
function commandKey(message) {
	if (message.type === "load" && message.keepCamera === true && !message.append) return "frame";
	if (message.type === "style")
		return "style:" + JSON.stringify([message.chain, message.residue]);
	return ["select", "theme", "visibility", "water"].includes(message.type)
		? message.type
		: null;
}
function schedule(message) {
	const key = commandKey(message),
		last = pending.at(-1);
	if (key && last && commandKey(last) === key)
		pending[pending.length - 1] = message;
	else pending.push(message);
	if (drainTimer !== null) return;
	drainTimer = setTimeout(() => {
		drainTimer = null;
		queue = queue.then(async () => {
			while (pending.length) {
				const message = pending.shift();
				try {
					await execute(message);
				} catch (error) {
					emit("error", {
						fatal: message.type === "load" && !message.append,
						command: message.type,
						message:
							error instanceof Error ? error.message : "Mol* unavailable",
					});
				}
			}
		});
	}, 0);
}
window.addEventListener("message", (event) => {
	if (event.source !== parent || event.data?.channel !== "evo-protein") return;
	if (event.data.type === "hello") { emit("booted"); return; }
	schedule(event.data);
});
window.addEventListener("pagehide", () => {
	clearTimeout(drainTimer);
	clearTimeout(cameraSaveTimer);
	pending.length = 0;
	viewer?.dispose();
});
