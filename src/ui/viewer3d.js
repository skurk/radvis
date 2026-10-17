// 3D scene: antenna geometry, draggable endpoints and the radiation pattern
// surface. Uses three.js from a CDN via the import map in index.html.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UP = new THREE.Vector3(0, 0, 1);

const COLOR_STOPS = [
  [0.0, 0x1b2a6b],
  [0.25, 0x1d8fd1],
  [0.5, 0x27c08a],
  [0.72, 0xe3c33a],
  [1.0, 0xe5443a],
];

function colorAt(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [p1, c1] = COLOR_STOPS[i - 1];
    const [p2, c2] = COLOR_STOPS[i];
    if (x <= p2) {
      const f = (x - p1) / (p2 - p1 || 1);
      const r = ((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * f;
      const g = ((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * f;
      const b = (c1 & 255) + ((c2 & 255) - (c1 & 255)) * f;
      return [r / 255, g / 255, b / 255];
    }
  }
  return [1, 1, 1];
}

/** Appends a capless cylinder between a and b into the supplied arrays. */
function pushTube(pos, col, idx, a, b, radius, rgb, sides = 8) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len < 1e-12) return;
  dir.divideScalar(len);
  const ref = Math.abs(dir.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const base = pos.length / 3;
  for (let i = 0; i < sides; i++) {
    const ang = (i / sides) * Math.PI * 2;
    const ox = u.x * Math.cos(ang) * radius + v.x * Math.sin(ang) * radius;
    const oy = u.y * Math.cos(ang) * radius + v.y * Math.sin(ang) * radius;
    const oz = u.z * Math.cos(ang) * radius + v.z * Math.sin(ang) * radius;
    pos.push(a.x + ox, a.y + oy, a.z + oz);
    col.push(rgb[0], rgb[1], rgb[2]);
    pos.push(b.x + ox, b.y + oy, b.z + oz);
    col.push(rgb[0], rgb[1], rgb[2]);
  }
  for (let i = 0; i < sides; i++) {
    const i0 = base + i * 2;
    const i1 = base + i * 2 + 1;
    const j0 = base + ((i + 1) % sides) * 2;
    const j1 = j0 + 1;
    idx.push(i0, j0, i1, i1, j0, j1);
  }
}

/** Billboard label drawn from a canvas texture, since three.js has no text. */
function makeLabel(text) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 62px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillText(text, size / 2 + 2, size / 2 + 2);
  ctx.fillStyle = '#6f768a';
  ctx.fillText(text, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false,
  }));
  sprite.renderOrder = 13;
  return sprite;
}

export class Viewer3D {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.options = {
      showPattern: true,
      showWires: true,
      showHandles: true,
      patternScale: 'db',
      dbRange: 40,
      patternOpacity: 0.85,
      showCurrent: true,
    };
    this.model = null;
    this.result = null;
    this.extent = 1;
    this.lambda = 1;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1020);

    this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.01, 5000);
    this.camera.up.copy(UP);
    this.camera.position.set(2, -2.4, 1.6);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, -3, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(2, 20, 0x3b4a7a, 0x1d2746);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(1);
    this.scene.add(this.axes);

    this.compass = new THREE.Group();
    for (const dir of ['N', 'E', 'S', 'W']) {
      const label = makeLabel(dir);
      label.userData.dir = dir;
      this.compass.add(label);
    }
    this.scene.add(this.compass);

    this.wireGroup = new THREE.Group();
    this.handleGroup = new THREE.Group();
    this.patternGroup = new THREE.Group();
    this.scene.add(this.wireGroup, this.handleGroup, this.patternGroup);

    this.groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x2b6cb0, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.groundMesh.visible = false;
    this.scene.add(this.groundMesh);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane();
    this.dragTarget = null;
    this.dragOffset = new THREE.Vector3();

    this._bindPointer();
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(container);
    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  setOptions(patch) {
    Object.assign(this.options, patch);
    this.wireGroup.visible = this.options.showWires;
    this.handleGroup.visible = this.options.showWires && this.options.showHandles;
    this.patternGroup.visible = this.options.showPattern;
    if (this.result) this._buildPattern();
    this._buildWires();
  }

  setModel(model, { fit = false } = {}) {
    this.model = model;
    this.lambda = 299792458 / (model.frequencyMHz * 1e6);
    this.heightOffset = model.heightOffset ?? 0;
    this._updateExtent();
    this._buildWires();
    this._buildHandles();
    this.groundMesh.visible = model.ground === 'perfect';
    const s = this.extent * 4;
    this.groundMesh.geometry.dispose();
    this.groundMesh.geometry = new THREE.PlaneGeometry(s, s);
    this.grid.scale.setScalar(this.extent * 2);
    this.axes.scale.setScalar(this.extent * 0.8);
    this._placeCompass();
    if (fit) this.fitView();
  }

  /** Sits the N/E/S/W labels just outside the ground grid. */
  _placeCompass() {
    const r = this.extent * 2.12;
    const s = this.extent * 0.22;
    const at = { N: [0, r, 0], E: [r, 0, 0], S: [0, -r, 0], W: [-r, 0, 0] };
    for (const label of this.compass.children) {
      label.position.set(...at[label.userData.dir]);
      label.scale.set(s, s, 1);
    }
  }

  setResult(result) {
    this.result = result;
    this._buildWires();
    this._buildPattern();
  }

  clearResult() {
    this.result = null;
    this._disposeGroup(this.patternGroup);
    this._buildWires();
  }

  /** Rebuilds only the conductor geometry (used while dragging a handle). */
  refreshWires() {
    this._updateExtent();
    this._buildWires();
  }

  fitView() {
    const r = Math.max(this.extent, this._patternRadius()) * 2.8;
    this.controls.target.set(0, 0, this.model?.ground === 'perfect' ? this.extent * 0.3 : 0);
    this.camera.position.set(r * 0.75, -r * 0.9, r * 0.5);
    this.controls.update();
  }

  /** Big enough to enclose the antenna, so the lobes read against the structure. */
  _patternRadius() {
    return Math.max(this.patternReach * 1.25, this.lambda * 0.35);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  dispose() {
    this._observer.disconnect();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
  }

  _animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** `span` is the antenna's own size; `extent` also covers how high it sits. */
  _updateExtent() {
    let span = 0;
    let top = 0;
    const dz = this.heightOffset ?? 0;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const w of this.model.wires) {
      for (const p of [w.p1, w.p2]) {
        span = Math.max(span, Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
        top = Math.max(top, Math.abs(p[2] + dz));
        const z = p[2] + dz;
        lo[0] = Math.min(lo[0], p[0]); hi[0] = Math.max(hi[0], p[0]);
        lo[1] = Math.min(lo[1], p[1]); hi[1] = Math.max(hi[1], p[1]);
        lo[2] = Math.min(lo[2], z); hi[2] = Math.max(hi[2], z);
      }
    }
    this.span = Math.max(span, 1e-3);
    this.extent = Math.max(this.span, top);

    // Energy leaves the conductors, so the lobes radiate from the antenna itself —
    // over ground they simply stop at the horizon.
    this.patternAnchor = [
      (lo[0] + hi[0]) / 2,
      (lo[1] + hi[1]) / 2,
      (lo[2] + hi[2]) / 2,
    ];
    let reach = 0;
    for (const w of this.model.wires) {
      for (const p of [w.p1, w.p2]) {
        reach = Math.max(reach, Math.hypot(
          p[0] - this.patternAnchor[0],
          p[1] - this.patternAnchor[1],
          p[2] + dz - this.patternAnchor[2],
        ));
      }
    }
    this.patternReach = Math.max(reach, 1e-3);
  }

  _disposeGroup(group) {
    while (group.children.length) {
      const c = group.children.pop();
      c.geometry?.dispose();
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
      else c.material?.dispose();
    }
  }

  _buildWires() {
    if (!this.model) return;
    this._disposeGroup(this.wireGroup);
    const pos = [];
    const col = [];
    const idx = [];
    const drawRadius = (r) => Math.max(r, this.span * 0.016);

    const useCurrent = this.options.showCurrent && this.result?.segmentCurrents?.length;
    if (useCurrent) {
      let maxI = 0;
      for (const v of this.result.segmentCurrents) maxI = Math.max(maxI, v);
      maxI = maxI || 1;
      this.result.segments.forEach((s, i) => {
        const rgb = colorAt(this.result.segmentCurrents[i] / maxI);
        pushTube(pos, col, idx,
          new THREE.Vector3(...s.p1), new THREE.Vector3(...s.p2), drawRadius(s.radius), rgb);
      });
    } else {
      const dz = this.heightOffset ?? 0;
      for (const w of this.model.wires) {
        pushTube(pos, col, idx,
          new THREE.Vector3(w.p1[0], w.p1[1], w.p1[2] + dz),
          new THREE.Vector3(w.p2[0], w.p2[1], w.p2[2] + dz),
          drawRadius(w.radius), [0.93, 0.95, 1]);
      }
    }

    if (!pos.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.wireGroup.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0xffffff,
      emissiveIntensity: 0.18,
    })));

    // Second pass without depth testing, so the conductors stay readable
    // even when they are buried inside the pattern surface.
    const ghost = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    }));
    ghost.renderOrder = 10;
    this.wireGroup.add(ghost);

    const feed = this.result?.feedPoint ?? this._feedPoint();
    if (feed) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(this.span * 0.028, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xff3b6b, depthTest: false, depthWrite: false, transparent: true }),
      );
      marker.position.set(...feed);
      marker.renderOrder = 11;
      marker.userData.isFeed = true;
      this.wireGroup.add(marker);
    }
  }

  _feedPoint() {
    const w = this.model.wires.find((x) => x.id === this.model.feed.wireId);
    if (!w) return null;
    const f = this.model.feed.fraction;
    const p = [0, 1, 2].map((i) => w.p1[i] + (w.p2[i] - w.p1[i]) * f);
    p[2] += this.heightOffset ?? 0;
    return p;
  }

  _buildHandles() {
    this._disposeGroup(this.handleGroup);
    const geo = new THREE.SphereGeometry(this.span * 0.032, 16, 12);
    const dz = this.heightOffset ?? 0;
    for (const w of this.model.wires) {
      for (const end of [0, 1]) {
        const mesh = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({
          color: 0x7fd1ff,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
        }));
        const p = end === 0 ? w.p1 : w.p2;
        mesh.position.set(p[0], p[1], p[2] + dz);
        mesh.renderOrder = 12;
        mesh.userData = { wireId: w.id, end };
        this.handleGroup.add(mesh);
      }
    }
    this.handleGroup.visible = this.options.showWires && this.options.showHandles;
  }

  _buildPattern() {
    this._disposeGroup(this.patternGroup);
    if (!this.result || !this.options.showPattern) return;
    this.patternGroup.position.set(...this.patternAnchor);
    const { thetaCount, phiCount, stepDeg, gainDb } = this.result.pattern;
    const maxDb = this.result.gainDbi;
    const range = this.options.dbRange;
    const scale = this._patternRadius();

    const pos = new Float32Array(thetaCount * phiCount * 3);
    const col = new Float32Array(thetaCount * phiCount * 3);
    const idx = [];

    for (let it = 0; it < thetaCount; it++) {
      const th = (it * stepDeg * Math.PI) / 180;
      for (let ip = 0; ip < phiCount; ip++) {
        const ph = (ip * stepDeg * Math.PI) / 180;
        const g = gainDb[it * phiCount + ip];
        let r;
        if (this.options.patternScale === 'db') {
          r = Math.max(0, (g - (maxDb - range)) / range);
        } else {
          r = Math.pow(10, (g - maxDb) / 10);
        }
        if (!Number.isFinite(r)) r = 0;
        const k = (it * phiCount + ip) * 3;
        const rr = r * scale;
        pos[k] = rr * Math.sin(th) * Math.cos(ph);
        pos[k + 1] = rr * Math.sin(th) * Math.sin(ph);
        pos[k + 2] = rr * Math.cos(th);
        const rgb = colorAt(r);
        col[k] = rgb[0];
        col[k + 1] = rgb[1];
        col[k + 2] = rgb[2];
      }
    }
    for (let it = 0; it < thetaCount - 1; it++) {
      for (let ip = 0; ip < phiCount - 1; ip++) {
        const a = it * phiCount + ip;
        const b = a + 1;
        const c = a + phiCount;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: this.options.patternOpacity < 1,
      opacity: this.options.patternOpacity,
      side: THREE.DoubleSide,
      roughness: 0.6,
      metalness: 0.05,
      depthWrite: this.options.patternOpacity > 0.95,
    });
    this.patternGroup.add(new THREE.Mesh(geo, mat));

    const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x0b1020, wireframe: true, transparent: true, opacity: 0.12 }));
    this.patternGroup.add(wire);
    this.patternGroup.visible = true;
  }

  _bindPointer() {
    const el = this.renderer.domElement;
    const toPointer = (ev) => {
      const rect = el.getBoundingClientRect();
      this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    };

    el.addEventListener('pointerdown', (ev) => {
      if (!this.options.showHandles || !this.handleGroup.visible) return;
      toPointer(ev);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.handleGroup.children, false)[0];
      if (!hit) return;
      this.dragTarget = hit.object;
      this.controls.enabled = false;
      const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
      this.dragPlane.setFromNormalAndCoplanarPoint(normal, this.dragTarget.position);
      this.dragOffset.copy(this.dragTarget.position).sub(hit.point);
      el.setPointerCapture(ev.pointerId);
      this.dragTarget.material.color.set(0xffd166);
    });

    el.addEventListener('pointermove', (ev) => {
      if (!this.dragTarget) return;
      toPointer(ev);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(this.dragPlane, p)) return;
      p.add(this.dragOffset);
      if (this.model?.ground === 'perfect' && p.z < 0) p.z = 0;
      this.dragTarget.position.copy(p);
      const { wireId, end } = this.dragTarget.userData;
      this.callbacks.onHandleDrag?.(wireId, end, [p.x, p.y, p.z], false);
    });

    const endDrag = (ev) => {
      if (!this.dragTarget) return;
      const { wireId, end } = this.dragTarget.userData;
      const p = this.dragTarget.position;
      this.dragTarget.material.color.set(0x7fd1ff);
      this.dragTarget = null;
      this.controls.enabled = true;
      el.releasePointerCapture?.(ev.pointerId);
      this.callbacks.onHandleDrag?.(wireId, end, [p.x, p.y, p.z], true);
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  }
}

export { colorAt };
