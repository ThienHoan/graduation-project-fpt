"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface Heritage3DWorldProps {
  className?: string;
  intensity?: number;
  showCenterpiece?: boolean;
}

/**
 * Heritage3DWorld — Không Gian 3D Di Sản Hoàng Kim Xuyên Không (Three.js r186+)
 * 
 * Thiết kế theo tiêu chuẩn Three.js & Scroll-Craft đẳng cấp như XimiTech:
 * 1. Trung tâm: Bảo Vật Hoàng Cung 3D (Imperial Golden Seal & Celestial Rings)
 *    - Render bằng PBR Materials (MeshStandardMaterial) với độ bóng kim hoàn & ngọc bích.
 *    - Các vành nhật nguyệt (Orbital Concentric Rings) xoay êm ái đa trục.
 * 2. Dải lụa sóng đôi (Dual Flowing Silk Ribbons) uốn lượn toán học mềm mại.
 * 3. Hạt bụi vàng & tàn hồng hoàng cung (Gilded Dust Particles) phát sáng additive.
 * 4. Hệ thống ánh sáng động (Dynamic PointLight): Ánh kim phản xạ chân thực theo tọa độ chuột.
 * 5. Scroll-linked Camera scrub: Đồng bộ góc nhìn 3D mượt mà theo tiến trình cuộn trang.
 * 6. Tối ưu hóa 120fps, Low-power mode & tự ngắt render khi ra ngoài viewport.
 */
export function Heritage3DWorld({
  className = "",
  intensity = 1,
  showCenterpiece = true,
}: Heritage3DWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Cinematic Fog
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x09090c, 0.0065);

    // 2. Camera
    const camera = new THREE.PerspectiveCamera(52, width / height, 0.1, 1000);
    camera.position.set(0, 0, 95);

    // 3. WebGL Renderer với cấu hình cao cấp
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    // 4. Lighting Rig (Chiếu sáng studio kim hoàn hoàng gia)
    const ambientLight = new THREE.AmbientLight(0xfff5eb, 0.9 * intensity);
    scene.add(ambientLight);

    // Đèn chính góc chiếu ấm áp vàng hoàng gia
    const dirLight = new THREE.DirectionalLight(0xfbbf24, 2.2 * intensity);
    dirLight.position.set(40, 50, 45);
    scene.add(dirLight);

    // Đèn viền xanh ngọc bích đối lập (Cyan/Jade Rim light) tạo chiều sâu điện ảnh
    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4 * intensity);
    rimLight.position.set(-45, -30, -35);
    scene.add(rimLight);

    // Đèn điểm động theo trỏ chuột (Specular cursor tracking light)
    const cursorLight = new THREE.PointLight(0xfde68a, 3.5 * intensity, 120, 1.5);
    cursorLight.position.set(0, 0, 30);
    scene.add(cursorLight);

    // Array gom nhóm tài nguyên để dispose sạch sẽ
    const disposables: { dispose: () => void }[] = [
      ambientLight,
      dirLight,
      rimLight,
      cursorLight,
    ];

    // 5. Trung tâm 3D: Bảo Vật Hoàng Cung (Centerpiece Artifact Group)
    const artifactGroup = new THREE.Group();
    // Đặt lệch nhẹ sang phải (vùng bên dưới hoặc sau card spotlight) trên desktop
    const isDesktop = width >= 1024;
    artifactGroup.position.set(isDesktop ? 26 : 0, isDesktop ? 2 : -4, -12);
    scene.add(artifactGroup);

    if (showCenterpiece) {
      // Chất liệu Vàng Hoàng Triều (Gilded Gold PBR)
      const goldMaterial = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        metalness: 0.88,
        roughness: 0.22,
        emissive: 0x78350f,
        emissiveIntensity: 0.18,
      });
      disposables.push(goldMaterial);

      // Chất liệu Ngọc Bích Cung Đình (Imperial Jade PBR)
      const jadeMaterial = new THREE.MeshStandardMaterial({
        color: 0x0f766e,
        metalness: 0.35,
        roughness: 0.18,
        emissive: 0x042f2e,
        emissiveIntensity: 0.25,
      });
      disposables.push(jadeMaterial);

      // Đế Kim Ấn Bát Giác Hoàng Gia (Octagonal Imperial Seal Base)
      const sealBaseGeo = new THREE.CylinderGeometry(11, 13, 3.5, 8);
      const sealBaseMesh = new THREE.Mesh(sealBaseGeo, goldMaterial);
      sealBaseMesh.rotation.y = Math.PI / 8;
      artifactGroup.add(sealBaseMesh);
      disposables.push(sealBaseGeo);

      // Lõi Ngọc Bích Nạm Giữa (Inlaid Jade Disc Core)
      const jadeCoreGeo = new THREE.CylinderGeometry(8.5, 8.5, 4.2, 32);
      const jadeCoreMesh = new THREE.Mesh(jadeCoreGeo, jadeMaterial);
      artifactGroup.add(jadeCoreMesh);
      disposables.push(jadeCoreGeo);

      // Đỉnh Kim Bảo Hoàng Đế (Golden Seal Crown Finial)
      const crownGeo = new THREE.ConeGeometry(5.2, 5.5, 8);
      const crownMesh = new THREE.Mesh(crownGeo, goldMaterial);
      crownMesh.position.y = 4.2;
      crownMesh.rotation.y = Math.PI / 8;
      artifactGroup.add(crownMesh);
      disposables.push(crownGeo);

      // Vành Nhật Nguyệt Ngoài Cùng (Outer Celestial Torus Ring)
      const outerRingGeo = new THREE.TorusGeometry(20, 0.45, 16, 64);
      const ringMaterial = new THREE.MeshStandardMaterial({
        color: 0xfcd34d,
        metalness: 0.92,
        roughness: 0.15,
        wireframe: false,
      });
      const outerRing = new THREE.Mesh(outerRingGeo, ringMaterial);
      outerRing.rotation.x = Math.PI / 3;
      artifactGroup.add(outerRing);
      disposables.push(outerRingGeo, ringMaterial);

      // Vành Nhật Nguyệt Thứ Hai (Middle Tilted Ring with dashed accents)
      const midRingGeo = new THREE.TorusGeometry(16, 0.35, 12, 48);
      const midRing = new THREE.Mesh(midRingGeo, ringMaterial);
      midRing.rotation.y = Math.PI / 4;
      midRing.rotation.z = Math.PI / 6;
      artifactGroup.add(midRing);
      disposables.push(midRingGeo);

      // Hạt tinh tú hộ vệ xoay quanh bảo vật
      const satelliteCount = 6;
      const satGeo = new THREE.SphereGeometry(0.75, 16, 16);
      disposables.push(satGeo);
      for (let i = 0; i < satelliteCount; i++) {
        const satMesh = new THREE.Mesh(satGeo, goldMaterial);
        const angle = (i / satelliteCount) * Math.PI * 2;
        satMesh.position.set(Math.cos(angle) * 17.5, Math.sin(angle) * 3, Math.sin(angle) * 17.5);
        artifactGroup.add(satMesh);
      }
    }

    // 6. Dải Lụa Sóng Tơ Tằm 3D (Dual Parametric Silk Ribbons)
    const ribbonSegmentsX = 80;
    const ribbonSegmentsY = 36;
    const ribbonGeo1 = new THREE.PlaneGeometry(175, 85, ribbonSegmentsX, ribbonSegmentsY);
    const origPos1 = ribbonGeo1.attributes.position.clone();
    disposables.push(ribbonGeo1);

    const ribbonMat1 = new THREE.MeshBasicMaterial({
      color: 0xd97706,
      wireframe: true,
      transparent: true,
      opacity: 0.24 * intensity,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(ribbonMat1);

    const ribbonMesh1 = new THREE.Mesh(ribbonGeo1, ribbonMat1);
    ribbonMesh1.rotation.x = -Math.PI / 2.9;
    ribbonMesh1.rotation.z = Math.PI / 5.2;
    ribbonMesh1.position.set(8, -8, -25);
    scene.add(ribbonMesh1);

    // Dải lụa thứ hai đối xứng mềm mại phía sau
    const ribbonGeo2 = new THREE.PlaneGeometry(160, 70, 64, 28);
    const origPos2 = ribbonGeo2.attributes.position.clone();
    disposables.push(ribbonGeo2);

    const ribbonMat2 = new THREE.MeshBasicMaterial({
      color: 0xe11d48,
      wireframe: true,
      transparent: true,
      opacity: 0.16 * intensity,
      blending: THREE.AdditiveBlending,
    });
    disposables.push(ribbonMat2);

    const ribbonMesh2 = new THREE.Mesh(ribbonGeo2, ribbonMat2);
    ribbonMesh2.rotation.x = -Math.PI / 3.4;
    ribbonMesh2.rotation.z = -Math.PI / 4.5;
    ribbonMesh2.position.set(-15, 12, -35);
    scene.add(ribbonMesh2);

    // 7. Hạt Bụi Vàng & Tàn Hồng Hoàng Cung (Floating Gold Dust)
    const particleCount = 140;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particlePhases = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 240;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 150;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 140;
      particlePhases[i] = Math.random() * Math.PI * 2;
    }

    particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    disposables.push(particleGeo);

    // Vẽ texture hạt sáng tròn mịn bằng canvas 2D
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(253, 224, 71, 1)"); // Vàng sáng
      grad.addColorStop(0.35, "rgba(245, 158, 11, 0.75)"); // Vàng hổ phách
      grad.addColorStop(0.7, "rgba(225, 29, 72, 0.35)"); // Đỏ son
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(32, 32, 32, 0, Math.PI * 2);
      ctx.fill();
    }
    const particleTexture = new THREE.CanvasTexture(canvas);
    disposables.push(particleTexture);

    const particleMat = new THREE.PointsMaterial({
      size: 4.8,
      map: particleTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.88,
    });
    disposables.push(particleMat);

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // 8. Tương tác Parallax Chuột & Cuộn Trang
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;
    let scrollY = 0;
    let targetScrollY = 0;

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      targetMouseX = x * 26;
      targetMouseY = -y * 26;

      // Di chuyển nguồn sáng theo chuột để tạo phản chiếu bóng bẩy
      cursorLight.position.x = x * 50;
      cursorLight.position.y = -y * 50;
    };

    const onScroll = () => {
      targetScrollY = window.scrollY * 0.055;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    // 9. IntersectionObserver kiểm soát chu kỳ render
    let isVisible = true;
    let animationId: number;
    const clock = new THREE.Clock();

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          isVisible = e.isIntersecting;
        });
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    // 10. Vòng lặp Render (120fps trên màn hình tần số quét cao)
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (!isVisible) return;

      const time = clock.getElapsedTime();

      // Lerping mượt mà
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;
      scrollY += (targetScrollY - scrollY) * 0.06;

      // Camera di chuyển theo cuộn và tương tác chuột
      camera.position.x = mouseX;
      camera.position.y = mouseY - scrollY * 0.16;
      camera.position.z = 95 - Math.sin(scrollY * 0.02) * 16;
      camera.lookAt(0, -scrollY * 0.1, 0);

      // Chuyển động xoay uy nghiêm của Bảo Vật Hoàng Gia
      if (showCenterpiece) {
        artifactGroup.rotation.y = time * 0.35 + scrollY * 0.02 + mouseX * 0.02;
        artifactGroup.rotation.x = Math.sin(time * 0.25) * 0.18 + mouseY * 0.015;
        artifactGroup.rotation.z = Math.cos(time * 0.2) * 0.08;
      }

      // Biến dạng dải lụa sóng tơ tằm 1
      const posAttr1 = ribbonGeo1.attributes.position as THREE.BufferAttribute;
      const posArr1 = posAttr1.array as Float32Array;
      const origArr1 = origPos1.array as Float32Array;

      for (let i = 0; i < posArr1.length; i += 3) {
        const u = origArr1[i] * 0.038;
        const v = origArr1[i + 1] * 0.048;
        const wave =
          Math.sin(u + time * 0.95) * 6.5 +
          Math.cos(v + time * 0.72) * 4.2 +
          Math.sin((u + v) * 0.52 + time * 1.15) * 3.2;
        posArr1[i + 2] = origArr1[i + 2] + wave;
      }
      posAttr1.needsUpdate = true;

      // Biến dạng dải lụa 2
      const posAttr2 = ribbonGeo2.attributes.position as THREE.BufferAttribute;
      const posArr2 = posAttr2.array as Float32Array;
      const origArr2 = origPos2.array as Float32Array;

      for (let i = 0; i < posArr2.length; i += 3) {
        const u = origArr2[i] * 0.042;
        const v = origArr2[i + 1] * 0.052;
        const wave =
          Math.cos(u + time * 0.8) * 5.5 +
          Math.sin(v + time * 0.65) * 3.8;
        posArr2[i + 2] = origArr2[i + 2] + wave;
      }
      posAttr2.needsUpdate = true;

      // Xoay dải lụa và cụm hạt bụi vàng
      ribbonMesh1.rotation.z = Math.PI / 5.2 + Math.sin(time * 0.18) * 0.06;
      particles.rotation.y = time * 0.032;
      particles.rotation.x = Math.sin(time * 0.02) * 0.045;

      renderer.render(scene, camera);
    };

    animate();

    // 11. Xử lý Resize màn hình
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);

      // Cập nhật vị trí trung tâm theo kích thước màn hình
      const desktop = w >= 1024;
      artifactGroup.position.set(desktop ? 26 : 0, desktop ? 2 : -4, -12);
    };
    window.addEventListener("resize", onResize);

    // 12. Cleanup chuẩn Three.js r186
    return () => {
      cancelAnimationFrame(animationId);
      observer.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      disposables.forEach((item) => item.dispose());
      renderer.dispose();
    };
  }, [intensity, showCenterpiece]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    />
  );
}
