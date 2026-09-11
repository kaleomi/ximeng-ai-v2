/* ============================================================
 * fluid-canvas.js — Canvas 2D 流体幻境背景（紫蓝冷色调）
 * 来源：用户提供的「流体幻境 | Fluid Dreamscape」示例
 * Stam's Stable Fluids (CPU) + Canvas 2D GPU 绘制 + 辉光粒子
 * 用法：<script src="/fluid-canvas.js"></script> 自动挂载全屏背景
 * ============================================================ */
(function () {
  'use strict';

  // ---- 画布（z-index:-1 垫在内容之下，避免盖住左右面板）----
  var canvas = document.createElement('canvas');
  canvas.id = 'fluidCanvas';
  canvas.style.cssText = 'display:block;position:fixed;top:0;left:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(canvas, document.body.firstChild);

  var ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;
  var offscreen = document.createElement('canvas');
  var offCtx = offscreen.getContext('2d', { alpha: true });

  var W, H;
  // mouse: 平滑后的位置; tm: 原始目标位置（用于 lerp 缓动）
  var mouse = { x: 0.5, y: 0.5, px: 0.5, py: 0.5, vx: 0, vy: 0 };
  var tm = { x: 0.5, y: 0.5 };
  var time = 0;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    var RES = 240;
    offscreen.width = RES;
    offscreen.height = Math.round(RES * H / W);
  }
  resize();
  window.addEventListener('resize', resize);

  // ============================================================
  //  Fluid Solver
  // ============================================================
  function FluidSolver() {
    this.N = 80;
    this.init();
  }
  FluidSolver.prototype.init = function () {
    var N = this.N, S = (N + 2) * (N + 2);
    this.u = new Float32Array(S);
    this.v = new Float32Array(S);
    this.u0 = new Float32Array(S);
    this.v0 = new Float32Array(S);
    this.d = new Float32Array(S);
    this.d0 = new Float32Array(S);
    this.curl = new Float32Array(S);
    this.diff = 0.00008;
    this.visc = 0.00004;
    this.dt = 0.016;
    this.iter = 8;
  };
  FluidSolver.prototype.idx = function (i, j) { return i + (this.N + 2) * j; };
  FluidSolver.prototype.addDensity = function (x, y, amt) {
    var N = this.N, i = Math.floor(x * N), j = Math.floor(y * N);
    if (i < 1 || i > N || j < 1 || j > N) return;
    this.d[this.idx(i, j)] += amt;
  };
  FluidSolver.prototype.addVelocity = function (x, y, ux, uy) {
    var N = this.N, i = Math.floor(x * N), j = Math.floor(y * N);
    if (i < 1 || i > N || j < 1 || j > N) return;
    var idx = this.idx(i, j);
    this.u[idx] += ux;
    this.v[idx] += uy;
  };
  FluidSolver.prototype.setBnd = function (b, x) {
    var N = this.N;
    for (var i = 1; i <= N; i++) {
      x[this.idx(0, i)] = b === 1 ? -x[this.idx(1, i)] : x[this.idx(1, i)];
      x[this.idx(N + 1, i)] = b === 1 ? -x[this.idx(N, i)] : x[this.idx(N, i)];
      x[this.idx(i, 0)] = b === 2 ? -x[this.idx(i, 1)] : x[this.idx(i, 1)];
      x[this.idx(i, N + 1)] = b === 2 ? -x[this.idx(i, N)] : x[this.idx(i, N)];
    }
    x[this.idx(0, 0)] = 0.5 * (x[this.idx(1, 0)] + x[this.idx(0, 1)]);
    x[this.idx(0, N + 1)] = 0.5 * (x[this.idx(1, N + 1)] + x[this.idx(0, N)]);
    x[this.idx(N + 1, 0)] = 0.5 * (x[this.idx(N, 0)] + x[this.idx(N + 1, 1)]);
    x[this.idx(N + 1, N + 1)] = 0.5 * (x[this.idx(N, N + 1)] + x[this.idx(N + 1, N)]);
  };
  FluidSolver.prototype.diffuse = function (b, x, x0, diff, dt) {
    var N = this.N, a = dt * diff * N * N;
    for (var k = 0; k < this.iter; k++) {
      for (var i = 1; i <= N; i++)
        for (var j = 1; j <= N; j++) {
          var idx = this.idx(i, j);
          x[idx] = (x0[idx] + a * (x[this.idx(i - 1, j)] + x[this.idx(i + 1, j)] + x[this.idx(i, j - 1)] + x[this.idx(i, j + 1)])) / (1 + 4 * a);
        }
      this.setBnd(b, x);
    }
  };
  FluidSolver.prototype.advect = function (b, d, d0, u, v, dt) {
    var N = this.N, dt0 = dt * N;
    for (var i = 1; i <= N; i++)
      for (var j = 1; j <= N; j++) {
        var x = i - dt0 * u[this.idx(i, j)];
        var y = j - dt0 * v[this.idx(i, j)];
        if (x < 0.5) x = 0.5; if (x > N + 0.5) x = N + 0.5;
        if (y < 0.5) y = 0.5; if (y > N + 0.5) y = N + 0.5;
        var i0 = Math.floor(x), i1 = i0 + 1;
        var j0 = Math.floor(y), j1 = j0 + 1;
        var s1 = x - i0, s0 = 1 - s1;
        var t1 = y - j0, t0 = 1 - t1;
        d[this.idx(i, j)] = s0 * (t0 * d0[this.idx(i0, j0)] + t1 * d0[this.idx(i0, j1)]) + s1 * (t0 * d0[this.idx(i1, j0)] + t1 * d0[this.idx(i1, j1)]);
      }
    this.setBnd(b, d);
  };
  FluidSolver.prototype.project = function (u, v, p, div) {
    var N = this.N;
    for (var i = 1; i <= N; i++)
      for (var j = 1; j <= N; j++) {
        var idx = this.idx(i, j);
        div[idx] = (u[this.idx(i + 1, j)] - u[this.idx(i - 1, j)] + v[this.idx(i, j + 1)] - v[this.idx(i, j - 1)]) * -0.5 / N;
        p[idx] = 0;
      }
    this.setBnd(0, div); this.setBnd(0, p);
    for (var k = 0; k < this.iter; k++)
      for (var i = 1; i <= N; i++)
        for (var j = 1; j <= N; j++) {
          var idx = this.idx(i, j);
          p[idx] = (div[idx] + p[this.idx(i - 1, j)] + p[this.idx(i + 1, j)] + p[this.idx(i, j - 1)] + p[this.idx(i, j + 1)]) * 0.25;
        }
    this.setBnd(0, p);
    for (var i = 1; i <= N; i++)
      for (var j = 1; j <= N; j++) {
        var idx = this.idx(i, j);
        u[idx] -= 0.5 * N * (p[this.idx(i + 1, j)] - p[this.idx(i - 1, j)]);
        v[idx] -= 0.5 * N * (p[this.idx(i, j + 1)] - p[this.idx(i, j - 1)]);
      }
    this.setBnd(1, u); this.setBnd(2, v);
  };
  FluidSolver.prototype.computeCurl = function () {
    var N = this.N;
    for (var i = 1; i <= N; i++)
      for (var j = 1; j <= N; j++) {
        var idx = this.idx(i, j);
        this.curl[idx] = (this.v[this.idx(i + 1, j)] - this.v[this.idx(i - 1, j)] - this.u[this.idx(i, j + 1)] + this.u[this.idx(i, j - 1)]) * 0.5 * N;
      }
  };
  FluidSolver.prototype.step = function () {
    this.diffuse(1, this.u0, this.u, this.visc, this.dt);
    this.diffuse(2, this.v0, this.v, this.visc, this.dt);
    this.project(this.u0, this.v0, this.u, this.v);
    this.advect(1, this.u, this.u0, this.u0, this.v0, this.dt);
    this.advect(2, this.v, this.v0, this.u0, this.v0, this.dt);
    this.project(this.u, this.v, this.u0, this.v0);
    this.diffuse(0, this.d0, this.d, this.diff, this.dt);
    this.advect(0, this.d, this.d0, this.u, this.v, this.dt);
    for (var i = 0; i < this.d.length; i++) {
      this.d[i] *= 0.993;
      this.u[i] *= 0.99;
      this.v[i] *= 0.99;
    }
    this.computeCurl();
  };

  // ============================================================
  //  Fluid Renderer（利用 canvas 径向渐变，GPU 加速）
  // ============================================================
  function FluidRenderer() { }
  FluidRenderer.prototype.render = function (v) {
    var w = offscreen.width, h = offscreen.height;
    offCtx.clearRect(0, 0, w, h);
    var N = v.N, d = v.d, curl = v.curl, u = v.u, vel = v.v;
    var sx = w / N, sy = h / N;
    for (var i = 1; i <= N; i++) {
      for (var j = 1; j <= N; j++) {
        var idx = v.idx(i, j);
        var dens = d[idx];
        if (dens < 0.01) continue;
        var x = (i - 0.5) * sx;
        var y = (j - 0.5) * sy;
        var curlVal = curl[idx];
        var speed = Math.sqrt(u[idx] * u[idx] + vel[idx] * vel[idx]);
        var t = time * 0.02;
        var hue1 = 260 + Math.sin(i * 0.1 + t) * 20 + curlVal * 20;
        var hue2 = 200 + Math.cos(j * 0.1 + t * 0.7) * 15 + dens * 10;
        var hue = (hue1 * 0.4 + hue2 * 0.6) % 360;
        var sat = 78 + dens * 14;
        var lig = 42 + dens * 38 + speed * 200;
        var radius = Math.max(sx * 0.9, dens * sx * 3.4);
        var grad = offCtx.createRadialGradient(x, y, 0, x, y, radius);
        grad.addColorStop(0, 'hsla(' + hue + ', ' + sat + '%, ' + Math.min(lig + 15, 94) + '%, ' + Math.min(dens * 1.0, 0.7) + ')');
        grad.addColorStop(0.3, 'hsla(' + hue + ', ' + sat + '%, ' + lig + '%, ' + Math.min(dens * 0.75, 0.45) + ')');
        grad.addColorStop(0.6, 'hsla(' + (hue + 20) + ', ' + (sat - 10) + '%, ' + (lig - 15) + '%, ' + Math.min(dens * 0.35, 0.22) + ')');
        grad.addColorStop(1, 'hsla(' + (hue + 40) + ', ' + (sat - 20) + '%, ' + (lig - 25) + '%, 0)');
        offCtx.fillStyle = grad;
        offCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
  };

  // ============================================================
  //  Glow Particles
  // ============================================================
  function GlowParticles() { this.particles = []; }
  GlowParticles.prototype.init = function (count) {
    count = count || 60;
    this.particles = [];
    for (var i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random(), y: Math.random(),
        vx: (Math.random() - 0.5) * 0.0008,
        vy: (Math.random() - 0.5) * 0.0008,
        size: 2 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
        hue: 200 + Math.random() * 80,
        alpha: 0.2 + Math.random() * 0.4
      });
    }
  };
  GlowParticles.prototype.update = function (dt, mx, my, v) {
    var N = v ? v.N : 80;
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      p.phase += dt * p.speed * 0.5;
      if (v) {
        var fi = Math.floor(p.x * N) + 1;
        var fj = Math.floor(p.y * N) + 1;
        if (fi >= 1 && fi <= N && fj >= 1 && fj <= N) {
          var idx = v.idx(fi, fj);
          p.vx += v.u[idx] * 0.4;
          p.vy += v.v[idx] * 0.4;
        }
      }
      var dx = mx - p.x, dy = my - p.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.25) {
        var force = (1 - dist / 0.25) * 0.0015;
        p.vx += dx * force;
        p.vy += dy * force;
      }
      p.vx += Math.sin(p.phase) * 0.00004;
      p.vy += Math.cos(p.phase * 0.7) * 0.00004;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
      if (p.y < 0) p.y = 1; if (p.y > 1) p.y = 0;
    }
  };
  GlowParticles.prototype.render = function (ctx2, w, h) {
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var x = p.x * w, y = p.y * h, s = p.size;
      var alpha = p.alpha * (0.5 + 0.5 * Math.sin(p.phase));
      var hue = p.hue + 15 * Math.sin(p.phase * 0.3);
      var grad = ctx2.createRadialGradient(x, y, 0, x, y, s * 5);
      grad.addColorStop(0, 'hsla(' + hue + ', 90%, 85%, ' + (alpha * 0.5) + ')');
      grad.addColorStop(0.2, 'hsla(' + hue + ', 85%, 72%, ' + (alpha * 0.25) + ')');
      grad.addColorStop(0.5, 'hsla(' + (hue + 30) + ', 80%, 55%, ' + (alpha * 0.08) + ')');
      grad.addColorStop(1, 'hsla(' + (hue + 60) + ', 70%, 40%, 0)');
      ctx2.fillStyle = grad;
      ctx2.fillRect(x - s * 5, y - s * 5, s * 10, s * 10);
      ctx2.beginPath();
      ctx2.arc(x, y, s * 0.4, 0, Math.PI * 2);
      ctx2.fillStyle = 'hsla(' + hue + ', 100%, 96%, ' + (alpha * 0.5) + ')';
      ctx2.fill();
    }
  };

  // ============================================================
  //  Main Loop
  // ============================================================
  var solver = new FluidSolver();
  var fluidRender = new FluidRenderer();
  var glow = new GlowParticles();
  var lastTime = 0;
  var frame = 0;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function animate(now) {
    frame = 0;
    if (document.hidden) return;
    if (now - lastTime < 1000 / 30) { frame = requestAnimationFrame(animate); return; }
    var dt = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;

    // ---- 鼠标平滑（lerp 缓动，更润滑）----
    var ease = 0.16; // 越小越跟手平滑
    mouse.x += (tm.x - mouse.x) * ease;
    mouse.y += (tm.y - mouse.y) * ease;

    var mdx = mouse.x - mouse.px;
    var mdy = mouse.y - mouse.py;
    mouse.vx = mdx / Math.max(dt, 0.001) * 0.22;
    mouse.vy = mdy / Math.max(dt, 0.001) * 0.22;
    mouse.px = mouse.x;
    mouse.py = mouse.y;
    time += dt;

    // ---- 鼠标轨迹注入（更强、更大）----
    solver.addDensity(mouse.x, mouse.y, 9.0 * dt);
    solver.addVelocity(mouse.x, mouse.y, mouse.vx * 0.7, mouse.vy * 0.7);
    // 鼠标邻近一圈也注入，形成更大的扰动范围
    for (var _k = 0; _k < 4; _k++) {
      var _a2 = Math.random() * Math.PI * 2;
      var _r2 = 0.015 + Math.random() * 0.03;
      solver.addDensity(mouse.x + Math.cos(_a2) * _r2, mouse.y + Math.sin(_a2) * _r2, 3.0 * dt);
    }
    // 周期性旋转注入（持续有机流动，更明显）
    var cx = 0.5 + 0.3 * Math.sin(time * 0.18);
    var cy = 0.5 + 0.3 * Math.cos(time * 0.15);
    solver.addDensity(cx, cy, 2.2 * dt);
    var sa = time * 0.3;
    solver.addVelocity(cx, cy, Math.cos(sa) * 0.08, Math.sin(sa) * 0.08);
    // 随机喷涌（更频繁）
    if (Math.random() < 0.05) {
      var rx = 0.1 + Math.random() * 0.8;
      var ry = 0.1 + Math.random() * 0.8;
      solver.addDensity(rx, ry, 1.8 + Math.random() * 2.5);
      var a = Math.random() * Math.PI * 2;
      solver.addVelocity(rx, ry, Math.cos(a) * 0.14, Math.sin(a) * 0.14);
    }

    solver.step();

    // 1. 深空背景（深蓝紫，比纯黑有色彩层次）
    ctx.fillStyle = '#0b0a1e';
    ctx.fillRect(0, 0, W, H);
    // 2. 离屏渲染流体光晕
    fluidRender.render(solver);
    // 3. 双线性缩放上屏
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(offscreen, 0, 0, W, H);
    // 4. 辉光粒子
    glow.update(dt, mouse.x, mouse.y, solver);
    glow.render(ctx, W, H);
    // 5. 柔和氛围：中央淡紫光提亮，四周深蓝紫渐隐（不压抑）
    var grad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.08, W / 2, H / 2, Math.max(W, H) * 0.8);
    grad.addColorStop(0, 'rgba(70,60,160,0.10)');
    grad.addColorStop(0.5, 'rgba(36,28,80,0.05)');
    grad.addColorStop(0.85, 'rgba(18,14,46,0.10)');
    grad.addColorStop(1, 'rgba(10,8,30,0.26)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (!reduceMotion.matches) frame = requestAnimationFrame(animate);
  }

  // 事件（绑定 window，因为 canvas 是 pointer-events:none；写入 tm 目标位置由主循环平滑跟随）
  window.addEventListener('mousemove', function (e) {
    tm.x = e.clientX / W;
    tm.y = e.clientY / H;
  });
  window.addEventListener('touchmove', function (e) {
    if (e.touches.length) {
      var t = e.touches[0];
      tm.x = t.clientX / W;
      tm.y = t.clientY / H;
    }
  }, { passive: true });
  window.addEventListener('touchstart', function (e) {
    if (e.touches.length) {
      var t = e.touches[0];
      tm.x = t.clientX / W;
      tm.y = t.clientY / H;
    }
  });

  // 初始注入
  function initApp() {
    glow.init(80);
    for (var i = 0; i < 50; i++) {
      var x = 0.15 + Math.random() * 0.7;
      var y = 0.15 + Math.random() * 0.7;
      solver.addDensity(x, y, 1.0 + Math.random() * 2.0);
      var a = Math.random() * Math.PI * 2;
      solver.addVelocity(x, y, Math.cos(a) * 0.1, Math.sin(a) * 0.1);
    }
    lastTime = performance.now() - 40;
    frame = requestAnimationFrame(animate);
  }

  function autoStart() {
    if (window.__fluidCanvasReady) return;
    window.__fluidCanvasReady = true;
    try {
      initApp();

    } catch (err) {

      console.error('[fluid-canvas] 启动失败', err);
    }
  }

  function resume() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (!document.hidden) { lastTime = performance.now() - 40; frame = requestAnimationFrame(animate); }
  }
  document.addEventListener('visibilitychange', resume);
  reduceMotion.addEventListener('change', resume);
  window.addEventListener('resize', resume);

  window.fluidCanvas = { init: autoStart };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoStart);
  } else {
    autoStart();
  }
})();
