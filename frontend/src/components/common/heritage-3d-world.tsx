"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";

interface Heritage3DWorldProps {
  className?: string;
  intensity?: number;
}

/**
 * Heritage3DWorld — Không Gian 3D Dải Lụa Hoàng Kim & Bụi Vàng Xuyên Không (Three.js)
 * Tái tạo đồ họa 3D đẳng cấp như XimiTech, tinh chỉnh cho Cổ Phục Rental:
 * - Dải lụa tơ tằm 3D (Parametric Silk Ribbon Mesh) uốn lượn theo sóng toán học
 * - 120 hạt bụi vàng hoàng cung & tia sáng kim tuyến lơ lửng
 * - Camera tương tác theo độ cuộn chuột (Scroll-linked Camera Motion) & Parallax chuột
 * - Chạy mượt mà 120fps, tự ngưng render khi khuất tầm nhìn
 */
export function Heritage3DWorld({ className = "", intensity = 1 }: Heritage3DWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x09090c, 0.007);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    camera.position.set(0, 0, 95);

    // 2. WebGL Renderer
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
    container.appendChild(renderer.domElement);

    // 3. Dải Lụa Sóng Tơ Tằm 3D (Flowing Silk Ribbon Plane)
    const ribbonSegmentsX = 64;
    const ribbonSegmentsY = 32;
    const ribbonGeo = new THREE.PlaneGeometry(160, 80, ribbonSegmentsX, ribbonSegmentsY);
    const originalPositions = ribbonGeo.attributes.position.clone();

    // Shader material mềm mại ánh kim vàng - đỏ thắm
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0xd4a373,
      wireframe: true,
      transparent: true,
      opacity: 0.22 * intensity,
      blending: THREE.AdditiveBlending,
    });

    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.rotation.x = -Math.PI / 3;
    ribbonMesh.rotation.z = Math.PI / 6;
    ribbonMesh.position.set(10, -10, -20);
    scene.add(ribbonMesh);

    // 4. Bụi Vàng & Tàn Hồng Hoàng Cung (Floating Gold Dust Particles)
    const particleCount = 110;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particlePhases = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 220;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 140;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 120;
      particlePhases[i] = Math.random() * Math.PI * 2;
    }

    particleGeo.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));

    // Vẽ texture hạt sáng tròn mịn
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "rgba(251, 191, 36, 1)");   // Vàng hổ phách
      grad.addColorStop(0.35, "rgba(225, 29, 72, 0.6)"); // Đỏ son sen
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(32, 32, 32, 0, Math.PI * 2);
      ctx.fill();
    }
    const particleTexture = new THREE.CanvasTexture(canvas);

    const particleMat = new THREE.PointsMaterial({
      size: 4.5,
      map: particleTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.85,
    });

    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // 5. Điều khiển Parallax Chuột & Cuộn Trang
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
      targetMouseX = x * 20;
      targetMouseY = -y * 20;
    };

    const onScroll = () => {
      targetScrollY = window.scrollY * 0.05;
    };

    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });

    // 6. IntersectionObserver để ngưng chạy khi khuất màn hình
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

    // 7. Animation Loop (120fps)
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (!isVisible) return;

      const time = clock.getElapsedTime();

      // Lerp chuyển động chuột & cuộn
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;
      scrollY += (targetScrollY - scrollY) * 0.06;

      // Camera di chuyển theo cuộn và chuột
      camera.position.x = mouseX;
      camera.position.y = mouseY - scrollY * 0.15;
      camera.position.z = 95 - Math.sin(scrollY * 0.02) * 15;
      camera.lookAt(0, -scrollY * 0.1, 0);

      // Biến dạng dải lụa 3D theo sóng sin/cos
      const posAttr = ribbonGeo.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;
      const origArray = originalPositions.array as Float32Array;

      for (let i = 0; i < posArray.length; i += 3) {
        const u = origArray[i] * 0.04;
        const v = origArray[i + 1] * 0.05;
        // Sóng lụa bay lượn kết hợp
        const wave =
          Math.sin(u + time * 0.9) * 6 +
          Math.cos(v + time * 0.7) * 4 +
          Math.sin((u + v) * 0.5 + time * 1.2) * 3;
        posArray[i + 2] = origArray[i + 2] + wave;
      }
      posAttr.needsUpdate = true;

      // Xoay nhẹ dải lụa và cụm hạt
      ribbonMesh.rotation.z = Math.PI / 6 + Math.sin(time * 0.2) * 0.05;
      particles.rotation.y = time * 0.03;
      particles.rotation.x = Math.sin(time * 0.02) * 0.04;

      renderer.render(scene, camera);
    };

    animate();

    // 8. Resize Handler
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      observer.disconnect();
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      ribbonGeo.dispose();
      ribbonMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      particleTexture.dispose();
      renderer.dispose();
    };
  }, [intensity]);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      aria-hidden="true"
    />
  );
}
