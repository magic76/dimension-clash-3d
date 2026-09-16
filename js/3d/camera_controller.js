/**
 * 跨次元大亂鬥 (Dimension Clash Online) - 3D 視角控制器
 * 支援三大核心視角：第三人稱 (身後背後視角)、第一人稱 (向前視線)、上方俯瞰 (Top-Down)
 */

class CameraController3D {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // View Modes: "third_person", "first_person", "top_down"
    this.mode = "third_person";
    this.target = null; // Player fighter 3D object
    this.opponent = null; // Opponent fighter 3D object

    // Mouse & Orbit Parameters
    this.yaw = 0; // Horizontal rotation (radians)
    this.pitch = 0.25; // Vertical tilt (radians)
    this.distance = 15; // Distance behind character in 3rd person
    this.isDragging = false;
    this.previousMousePosition = { x: 0, y: 0 };

    this.smoothPosition = new THREE.Vector3(0, 15, 25);
    this.smoothLookAt = new THREE.Vector3(0, 2, 0);

    this.setupInputListeners();
  }

  setupInputListeners() {
    if (!this.domElement) return;

    // Mouse Drag to rotate camera in 3rd & 1st person
    this.domElement.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.previousMousePosition.x;
      const deltaY = e.clientY - this.previousMousePosition.y;

      const sensitivity = this.mode === "first_person" ? 0.003 : 0.005;
      this.yaw -= deltaX * sensitivity;
      this.pitch -= deltaY * sensitivity;

      if (this.mode === "first_person") {
        this.pitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, this.pitch));
      } else {
        this.pitch = Math.max(0.05, Math.min(Math.PI * 0.42, this.pitch));
      }

      this.previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    // Touch Drag for Mobile
    this.domElement.addEventListener("touchstart", (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      if (!this.isDragging || e.touches.length !== 1) return;
      const deltaX = e.touches[0].clientX - this.previousMousePosition.x;
      const deltaY = e.touches[0].clientY - this.previousMousePosition.y;

      const sensitivity = 0.005;
      this.yaw -= deltaX * sensitivity;
      this.pitch -= deltaY * sensitivity;
      this.pitch = Math.max(0.05, Math.min(Math.PI * 0.42, this.pitch));

      this.previousMousePosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: false });

    window.addEventListener("touchend", () => {
      this.isDragging = false;
    });
  }

  cycleViewMode() {
    if (this.mode === "third_person") {
      this.setViewMode("first_person");
    } else if (this.mode === "first_person") {
      this.setViewMode("top_down");
    } else {
      this.setViewMode("third_person");
    }
    return this.mode;
  }

  setViewMode(mode) {
    this.mode = mode;
    this.yaw = 0; // 重置視角偏移
    if (mode === "top_down") {
      this.pitch = Math.PI * 0.48; // Near vertical
    } else if (mode === "first_person") {
      this.pitch = 0;
    } else {
      this.pitch = 0.25;
    }
  }

  getViewModeLabel() {
    switch (this.mode) {
      case "first_person": return "👁️ 第一人稱 (1st Person)";
      case "third_person": return "🎥 第三人稱身後 (3rd Person)";
      case "top_down": return "🗺️ 上方俯瞰 (Top-Down)";
      default: return "3D 視角";
    }
  }

  update(dt) {
    if (!this.camera) return;
    if (!this.target) {
      this.camera.position.set(0, 16, 28);
      this.camera.lookAt(0, 2, 0);
      return;
    }

    const targetPos = this.target.position;
    let desiredCameraPos = new THREE.Vector3();
    let desiredLookAt = new THREE.Vector3();

    if (this.mode === "first_person") {
      // ── 第一人稱 (1st Person View) ──
      // 鏡頭置於角色眼部高度，向前看
      const eyeHeight = 2.4;
      desiredCameraPos.set(targetPos.x, targetPos.y + eyeHeight, targetPos.z);

      const charAngle = this.target.rotation.y + this.yaw;
      const lookDir = new THREE.Vector3(
        Math.sin(charAngle) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(charAngle) * Math.cos(this.pitch)
      );
      desiredLookAt.copy(desiredCameraPos).add(lookDir);

      this.camera.position.copy(desiredCameraPos);
      this.camera.lookAt(desiredLookAt);
      return;
    } 
    else if (this.mode === "top_down") {
      // ── 上方俯瞰視角 (Top-Down Bird's-Eye View) ──
      const midPoint = new THREE.Vector3().copy(targetPos);
      if (this.opponent) {
        midPoint.add(this.opponent.position).multiplyScalar(0.5);
      }

      desiredCameraPos.set(midPoint.x, midPoint.y + 45, midPoint.z + 18);
      desiredLookAt.set(midPoint.x, midPoint.y, midPoint.z);

      this.smoothPosition.lerp(desiredCameraPos, 0.1);
      this.smoothLookAt.lerp(desiredLookAt, 0.1);

      this.camera.position.copy(this.smoothPosition);
      this.camera.lookAt(this.smoothLookAt);
      return;
    } 
    else {
      // ── 第三人稱身後跟隨視角 (3rd Person Behind-the-Back Follow) ──
      // 鏡頭嚴格放置於角色背後 ( -sin, -cos )，朝前看目標
      const charAngle = this.target.rotation.y + this.yaw;
      const horizontalDist = this.distance * Math.cos(this.pitch);
      const verticalDist = this.distance * Math.sin(this.pitch) + 3.2;

      desiredCameraPos.set(
        targetPos.x - Math.sin(charAngle) * horizontalDist,
        targetPos.y + verticalDist,
        targetPos.z - Math.cos(charAngle) * horizontalDist
      );

      // 看向角色前方與對手位置
      desiredLookAt.set(
        targetPos.x + Math.sin(charAngle) * 5.0,
        targetPos.y + 2.2,
        targetPos.z + Math.cos(charAngle) * 5.0
      );

      if (this.opponent && !this.isDragging) {
        const oppPos = new THREE.Vector3(this.opponent.position.x, this.opponent.position.y + 2.0, this.opponent.position.z);
        desiredLookAt.lerp(oppPos, 0.65);
      }

      this.smoothPosition.lerp(desiredCameraPos, 0.14);
      this.smoothLookAt.lerp(desiredLookAt, 0.16);

      this.camera.position.copy(this.smoothPosition);
      this.camera.lookAt(this.smoothLookAt);
    }
  }
}

if (typeof window !== "undefined") {
  window.CameraController3D = CameraController3D;
}
