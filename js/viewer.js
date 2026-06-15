// ===== 3D viewer + parsers (STL / OBJ / 3DM) =====
// THREE is loaded globally from the CDN script tag.

export function createViewer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, container.clientWidth / container.clientHeight, 0.01, 1000);
  camera.position.set(0, 0, 5);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const k = new THREE.DirectionalLight(0xfff8e7, 1.2); k.position.set(5, 8, 5); scene.add(k);
  const f = new THREE.DirectionalLight(0xc8d8ff, 0.4); f.position.set(-5, 2, -3); scene.add(f);
  const rim = new THREE.DirectionalLight(0xffd080, 0.6); rim.position.set(0, -5, -5); scene.add(rim);

  const mats = {
    gold: { color: 0xc9a84c, metalness: 0.9, roughness: 0.15 },
    wgold: { color: 0xd4d4d8, metalness: 0.95, roughness: 0.08 },
    rose: { color: 0xc4715f, metalness: 0.88, roughness: 0.18 },
    platinum: { color: 0xe5e4e2, metalness: 0.98, roughness: 0.05 }
  };
  const meshMat = new THREE.MeshStandardMaterial(mats.gold);
  let mesh = null, rotX = 0.3, rotY = 0.5, zoom = 1, panX = 0, panY = 0, drag = false, right = false, lx = 0, ly = 0;

  const el = renderer.domElement; el.style.cursor = 'grab'; el.style.display = 'block';
  el.addEventListener('mousedown', e => { drag = true; right = e.button === 2; lx = e.clientX; ly = e.clientY; el.style.cursor = 'grabbing'; });
  window.addEventListener('mouseup', () => { drag = false; el.style.cursor = 'grab'; });
  window.addEventListener('mousemove', e => { if (!drag || !mesh) return; const dx = e.clientX - lx, dy = e.clientY - ly; if (right) { panX += dx * 0.003 * zoom; panY -= dy * 0.003 * zoom; } else { rotY += dx * 0.008; rotX += dy * 0.008; rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX)); } lx = e.clientX; ly = e.clientY; });
  el.addEventListener('wheel', e => { if (!mesh) return; zoom *= e.deltaY > 0 ? 1.08 : 0.93; zoom = Math.max(0.2, Math.min(10, zoom)); e.preventDefault(); }, { passive: false });
  el.addEventListener('contextmenu', e => e.preventDefault());
  let lt = null, lp = null;
  el.addEventListener('touchstart', e => { if (e.touches.length === 1) { lt = { x: e.touches[0].clientX, y: e.touches[0].clientY }; lp = null; } else if (e.touches.length === 2) { lp = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); } }, { passive: true });
  el.addEventListener('touchmove', e => { if (!mesh) return; if (e.touches.length === 1 && lt) { rotY += (e.touches[0].clientX - lt.x) * 0.01; rotX += (e.touches[0].clientY - lt.y) * 0.01; lt = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } else if (e.touches.length === 2 && lp) { const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); zoom *= lp / d; zoom = Math.max(0.2, Math.min(10, zoom)); lp = d; } e.preventDefault(); }, { passive: false });

  let running = true;
  (function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const w = container.clientWidth, h = container.clientHeight;
    if (w && h) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (mesh) { mesh.rotation.x = rotX; mesh.rotation.y = rotY; camera.position.set(panX, panY, 5 * zoom); camera.lookAt(panX, panY, 0); }
    renderer.render(scene, camera);
  })();

  return {
    setGeometry(parsed) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(parsed.positions, 3));
      if (parsed.normals) geo.setAttribute('normal', new THREE.BufferAttribute(parsed.normals, 3));
      else geo.computeVertexNormals();
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      mesh = new THREE.Mesh(geo, meshMat); scene.add(mesh);
      geo.computeBoundingBox();
      const c = new THREE.Vector3(); geo.boundingBox.getCenter(c); geo.translate(-c.x, -c.y, -c.z);
      const s = new THREE.Vector3(); geo.boundingBox.getSize(s);
      mesh.scale.setScalar(2.5 / Math.max(s.x, s.y, s.z));
      rotX = 0.3; rotY = 0.5; zoom = 1; panX = 0; panY = 0;
      return { dims: `${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)}`, tris: parsed.triangleCount };
    },
    setMaterial(key) { const m = mats[key]; if (m) { meshMat.color.setHex(m.color); meshMat.metalness = m.metalness; meshMat.roughness = m.roughness; meshMat.needsUpdate = true; } },
    reset() { rotX = 0.3; rotY = 0.5; zoom = 1; panX = 0; panY = 0; },
    zoom(f) { zoom = Math.max(0.2, Math.min(10, zoom * f)); },
    screenshot() { renderer.render(scene, camera); const a = document.createElement('a'); a.download = 'design.png'; a.href = renderer.domElement.toDataURL('image/png'); a.click(); },
    dispose() { running = false; renderer.dispose(); if (el.parentNode) el.parentNode.removeChild(el); }
  };
}

// ---- parsers ----
export function parseSTL(buffer) {
  const view = new DataView(buffer);
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength))).toLowerCase();
  let binary = true;
  if (header.startsWith('solid')) { const n = view.getUint32(80, true); binary = Math.abs(buffer.byteLength - (84 + n * 50)) < 10; }
  if (binary) {
    const n = view.getUint32(80, true); const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) { const o = 84 + i * 50; const nx = view.getFloat32(o, true), ny = view.getFloat32(o + 4, true), nz = view.getFloat32(o + 8, true);
      for (let v = 0; v < 3; v++) { const vo = o + 12 + v * 12; pos[i * 9 + v * 3] = view.getFloat32(vo, true); pos[i * 9 + v * 3 + 1] = view.getFloat32(vo + 4, true); pos[i * 9 + v * 3 + 2] = view.getFloat32(vo + 8, true); nor[i * 9 + v * 3] = nx; nor[i * 9 + v * 3 + 1] = ny; nor[i * 9 + v * 3 + 2] = nz; } }
    return { positions: pos, normals: nor, triangleCount: n };
  }
  const text = new TextDecoder().decode(buffer); const pa = [], na = []; let nx = 0, ny = 0, nz = 0;
  for (const line of text.split('\n')) { const t = line.trim();
    if (t.startsWith('facet normal')) { const p = t.split(/\s+/); nx = +p[2]; ny = +p[3]; nz = +p[4]; }
    else if (t.startsWith('vertex')) { const p = t.split(/\s+/); pa.push(+p[1], +p[2], +p[3]); na.push(nx, ny, nz); } }
  return { positions: new Float32Array(pa), normals: new Float32Array(na), triangleCount: pa.length / 9 };
}

export function parseOBJ(buffer) {
  const text = new TextDecoder().decode(buffer); const verts = [], faces = [];
  for (const line of text.split('\n')) { const t = line.trim();
    if (t.startsWith('v ')) { const p = t.split(/\s+/); verts.push([+p[1], +p[2], +p[3]]); }
    else if (t.startsWith('f ')) { const p = t.split(/\s+/).slice(1).map(x => parseInt(x.split('/')[0]) - 1); for (let i = 1; i < p.length - 1; i++) faces.push([p[0], p[i], p[i + 1]]); } }
  const pos = new Float32Array(faces.length * 9);
  for (let i = 0; i < faces.length; i++) for (let v = 0; v < 3; v++) { const vt = verts[faces[i][v]]; pos[i * 9 + v * 3] = vt[0]; pos[i * 9 + v * 3 + 1] = vt[1]; pos[i * 9 + v * 3 + 2] = vt[2]; }
  return { positions: pos, normals: null, triangleCount: faces.length };
}

let rhinoPromise = null;
function loadRhino() {
  if (rhinoPromise) return rhinoPromise;
  rhinoPromise = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.4.0/rhino3dm.min.js'; s.onload = () => rhino3dm().then(res).catch(rej); s.onerror = rej; document.head.appendChild(s); });
  return rhinoPromise;
}
export async function parse3DM(buffer) {
  const rhino = await loadRhino();
  const doc = rhino.File3dm.fromByteArray(new Uint8Array(buffer));
  if (!doc) throw new Error('Invalid 3DM file');
  const posAll = []; const objs = doc.objects();
  for (let i = 0; i < objs.count; i++) { const geo = objs.get(i).geometry();
    if (geo.objectType === rhino.ObjectType.Mesh) {
      const verts = geo.vertices(), faces = geo.faces(); const varr = [];
      for (let v = 0; v < verts.count; v++) { const pt = verts.get(v); varr.push([pt[0], pt[1], pt[2]]); }
      for (let fI = 0; fI < faces.count; fI++) { const face = faces.get(fI);
        posAll.push(...varr[face[0]], ...varr[face[1]], ...varr[face[2]]);
        if (face.length === 4 || face[3] !== face[2]) posAll.push(...varr[face[0]], ...varr[face[2]], ...varr[face[3]]); }
      verts.delete(); faces.delete();
    }
    geo.delete();
  }
  objs.delete(); doc.delete();
  if (!posAll.length) throw new Error('3DM has only NURBS surfaces (no mesh baked in)');
  return { positions: new Float32Array(posAll), normals: null, triangleCount: posAll.length / 9 };
}

export async function parseByExt(ext, buffer) {
  if (ext === 'stl') return parseSTL(buffer);
  if (ext === 'obj') return parseOBJ(buffer);
  if (ext === '3dm') return parse3DM(buffer);
  throw new Error('Unsupported format: ' + ext);
}
