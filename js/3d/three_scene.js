/**
 * 跨次元大亂鬥 (Dimension Clash Online) - 3D 引擎
 * 3D 場景、星空宇宙、競技場擂台、動態光影與環境渲染 (Three.js 3D Scene & Arena Manager)
 */

class Arena3DScene {
  constructor(container) {
    this.container = container;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.arenaRadius = 45;
    this.lights = {};
    this.arenaMesh = null;
    this.starfield = null;
  }

  init() {
    if (typeof THREE === "undefined") {
      console.error("Three.js is required for 3D version.");
      return;
    }

    // 1. Create Scene with Deep Cosmic Nebula Space
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b132b);
    this.scene.fog = new THREE.FogExp2(0x0b132b, 0.003); // 輕柔深空霧化，確保整個擂台與角色清晰無比

    // 2. Calculate Viewport Dimensions (Safe Fallback to avoid 0x0 aspect)
    const rect = this.container.getBoundingClientRect();
    const width = this.container.clientWidth || rect.width || window.innerWidth || 900;
    const height = this.container.clientHeight || rect.height || 580;
    const aspect = Math.max(0.1, width / height);

    // 3. Create Camera
    this.camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 1000);
    this.camera.position.set(0, 16, 28);

    // 4. Create WebGL Renderer with Anti-aliasing & High Performance (Safe Fallback)
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", alpha: false });
    } catch (e) {
      try {
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
      } catch (err2) {
        console.warn("WebGL renderer unavailable:", err2);
      }
    }

    if (this.renderer) {
      this.renderer.setClearColor(0x0b132b, 1);
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // Clear old canvases and append
      this.container.innerHTML = "";
      this.container.appendChild(this.renderer.domElement);
      this.renderer.domElement.id = "battleCanvas3D";
      this.renderer.domElement.style.width = "100%";
      this.renderer.domElement.style.height = "100%";
      this.renderer.domElement.style.display = "block";
    }

    // 5. Setup Rich Lighting
    this.setupLighting();

    // 6. Build 3D Arena & Space Environment
    this.buildEnvironment();
    this.buildArena();

    // 7. Resize listener
    window.addEventListener("resize", () => this.onWindowResize());
    setTimeout(() => this.onWindowResize(), 100);
  }

  setupLighting() {
    // 1. High Intensity Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    this.scene.add(ambientLight);
    this.lights.ambient = ambientLight;

    // 2. Main Directional Sun Light with Crisp Shadows
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(30, 55, 30);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 180;
    sunLight.shadow.camera.left = -60;
    sunLight.shadow.camera.right = 60;
    sunLight.shadow.camera.top = 60;
    sunLight.shadow.camera.bottom = -60;
    this.scene.add(sunLight);
    this.lights.sun = sunLight;

    // 3. Hemisphere Sky / Ground Contrast Light
    const hemiLight = new THREE.HemisphereLight(0x38bdf8, 0x1e1b4b, 1.2);
    this.scene.add(hemiLight);
    this.lights.hemi = hemiLight;

    // 4. Cyberpunk Colored Arena Floodlights
    const cyanLight = new THREE.PointLight(0x38bdf8, 3.5, 90);
    cyanLight.position.set(-32, 14, -22);
    this.scene.add(cyanLight);

    const magentaLight = new THREE.PointLight(0xec4899, 3.5, 90);
    magentaLight.position.set(32, 14, 22);
    this.scene.add(magentaLight);

    const goldLight = new THREE.PointLight(0xfacc15, 2.5, 80);
    goldLight.position.set(0, 24, 0);
    this.scene.add(goldLight);
  }

  buildEnvironment() {
    // 🌌 3D 宇宙星空粒子穹頂 (Starfield Sky Dome)
    const starGeo = new THREE.BufferGeometry();
    const starCount = 1500;
    const starPositions = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 450;
      starPositions[i + 1] = Math.random() * 220 + 2;
      starPositions[i + 2] = (Math.random() - 0.5) * 450;

      // 星光漸層色彩
      const isCyan = Math.random() > 0.4;
      starColors[i] = isCyan ? 0.3 : 1.0;
      starColors[i + 1] = isCyan ? 0.8 : 0.8;
      starColors[i + 2] = 1.0;
    }

    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 2.2,
      vertexColors: true,
      transparent: true,
      opacity: 0.9
    });

    this.starfield = new THREE.Points(starGeo, starMat);
    this.scene.add(this.starfield);
  }

  buildArena() {
    // 1. Circular Cyberpunk Fighting Arena Floor
    const arenaGeo = new THREE.CylinderGeometry(this.arenaRadius, this.arenaRadius + 2.5, 2.5, 64);
    const arenaMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.35,
      metalness: 0.65,
      emissive: 0x0f172a
    });
    this.arenaMesh = new THREE.Mesh(arenaGeo, arenaMat);
    this.arenaMesh.position.y = -1.25;
    this.arenaMesh.receiveShadow = true;
    this.scene.add(this.arenaMesh);

    // 2. Glowing Outer Arena Border Ring
    const ringGeo = new THREE.RingGeometry(this.arenaRadius - 0.8, this.arenaRadius + 0.8, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.05;
    this.scene.add(ringMesh);

    // 3. Outer Magenta Ring Accent
    const outerRingGeo = new THREE.RingGeometry(this.arenaRadius + 1.2, this.arenaRadius + 1.8, 64);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: 0xec4899,
      side: THREE.DoubleSide
    });
    const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRingMesh.rotation.x = -Math.PI / 2;
    outerRingMesh.position.y = 0.04;
    this.scene.add(outerRingMesh);

    // 4. Center Hexagon Fighting Ring Decal
    const innerRingGeo = new THREE.RingGeometry(14, 15.5, 6);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      side: THREE.DoubleSide
    });
    const innerRingMesh = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRingMesh.rotation.x = -Math.PI / 2;
    innerRingMesh.position.y = 0.06;
    this.scene.add(innerRingMesh);

    // 5. High-Tech Grid on Ground
    const gridHelper = new THREE.GridHelper(this.arenaRadius * 2, 36, 0x38bdf8, 0x3b82f6);
    gridHelper.position.y = 0.03;
    this.scene.add(gridHelper);

    // 6. Surrounding Sci-Fi Energy Pillars
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const px = Math.cos(angle) * (this.arenaRadius + 4);
      const pz = Math.sin(angle) * (this.arenaRadius + 4);

      const pillarGeo = new THREE.CylinderGeometry(1.4, 2.0, 18, 16);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        metalness: 0.8,
        roughness: 0.25
      });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(px, 8, pz);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      this.scene.add(pillar);

      // Glowing Beacon Top
      const beaconGeo = new THREE.SphereGeometry(1.0, 16, 16);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x38bdf8 : 0xec4899
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(px, 17.5, pz);
      this.scene.add(beacon);
    }
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const rect = this.container.getBoundingClientRect();
    const width = this.container.clientWidth || rect.width || window.innerWidth || 900;
    const height = this.container.clientHeight || rect.height || 580;

    if (width > 50 && height > 50) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
    }
  }

  // ─── 3D 戰鬥特效系統 (3D Visual Effects: Slashes, Sparks, Ki Blasts & Shockwaves) ───
  addSlashEffect(pos, rotY, color = 0x38bdf8, scale = 1.0) {
    if (!this.scene) return;
    const arcGeo = new THREE.TorusGeometry(2.4 * scale, 0.22 * scale, 8, 24, Math.PI * 0.85);
    const arcMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });
    const slash = new THREE.Mesh(arcGeo, arcMat);
    slash.position.set(pos.x, pos.y + 2.0, pos.z);
    slash.rotation.y = rotY + Math.PI * 0.5;
    slash.rotation.x = Math.PI * 0.25;
    this.scene.add(slash);

    if (!this.vfxList) this.vfxList = [];
    this.vfxList.push({
      mesh: slash,
      life: 0.22,
      maxLife: 0.22,
      type: "slash"
    });
  }

  addHitSpark(pos, color = 0xfacc15, count = 8) {
    if (!this.scene) return;
    if (!this.vfxList) this.vfxList = [];

    const sparkGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) });

    for (let i = 0; i < count; i++) {
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
      spark.position.set(pos.x, pos.y + 1.8, pos.z);
      this.scene.add(spark);

      const vx = (Math.random() - 0.5) * 16;
      const vy = (Math.random() * 8) + 2;
      const vz = (Math.random() - 0.5) * 16;

      this.vfxList.push({
        mesh: spark,
        vx, vy, vz,
        life: 0.35,
        maxLife: 0.35,
        type: "spark"
      });
    }
  }

  addEnergyBlast(startPos, targetPos, color = 0x38bdf8, radius = 0.8) {
    if (!this.scene) return;
    if (!this.vfxList) this.vfxList = [];

    const blastGeo = new THREE.SphereGeometry(radius, 12, 12);
    const blastMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.95
    });
    const blast = new THREE.Mesh(blastGeo, blastMat);
    blast.position.set(startPos.x, startPos.y + 2.0, startPos.z);
    this.scene.add(blast);

    const dx = targetPos.x - startPos.x;
    const dy = (targetPos.y + 2.0) - (startPos.y + 2.0);
    const dz = targetPos.z - startPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const speed = 40;

    this.vfxList.push({
      mesh: blast,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      vz: (dz / dist) * speed,
      life: dist / speed,
      maxLife: dist / speed,
      type: "energy_orb"
    });
  }

  updateVfx(dt) {
    if (!this.vfxList || this.vfxList.length === 0) return;

    for (let i = this.vfxList.length - 1; i >= 0; i--) {
      const fx = this.vfxList[i];
      fx.life -= dt;

      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        if (fx.mesh.geometry) fx.mesh.geometry.dispose();
        if (fx.mesh.material) fx.mesh.material.dispose();
        this.vfxList.splice(i, 1);
        continue;
      }

      const progress = fx.life / fx.maxLife;

      if (fx.type === "slash") {
        fx.mesh.scale.multiplyScalar(1.0 + dt * 4.0);
        fx.mesh.material.opacity = progress * 0.95;
      } else if (fx.type === "spark") {
        fx.mesh.position.x += fx.vx * dt;
        fx.mesh.position.y += fx.vy * dt;
        fx.mesh.position.z += fx.vz * dt;
        fx.vy -= 25 * dt; // 重力
        fx.mesh.scale.setScalar(progress);
      } else if (fx.type === "energy_orb") {
        fx.mesh.position.x += fx.vx * dt;
        fx.mesh.position.y += fx.vy * dt;
        fx.mesh.position.z += fx.vz * dt;
        fx.mesh.scale.multiplyScalar(1.02);
      }
    }
  }

  render() {
    if (this.renderer && this.scene && this.camera) {
      if (this.starfield) {
        this.starfield.rotation.y += 0.0003;
      }
      this.updateVfx(0.016);
      this.renderer.render(this.scene, this.camera);
    }
  }
}

if (typeof window !== "undefined") {
  window.Arena3DScene = Arena3DScene;
}
