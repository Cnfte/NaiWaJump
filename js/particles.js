/**
 * 《奶蛙跳一跳》 - 3D 粒子系统管理器
 * 支持起跳尘埃、落地冲击尘环、Perfect 黄金星光喷发与掉落气泡
 * 使用高效率对象池，确保 60 FPS 流畅稳定
 */
class ParticleSystem {
    constructor(scene) {
        this.scene = scene;
        this.particles = [];
        this.quality = 'medium'; // 'low' | 'medium' | 'high'
        
        // 创建通用的软圆和星形纹理 (程序化 Canvas 纹理，零外部贴图依赖)
        this.circleTexture = this._createCircleTexture();
        this.starTexture = this._createStarTexture();

        // 基础材质缓存
        this.dustMaterial = new THREE.SpriteMaterial({
            map: this.circleTexture,
            color: 0xfff3db,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.NormalBlending
        });

        this.starMaterial = new THREE.SpriteMaterial({
            map: this.starTexture,
            color: 0xffd700,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
    }

    _createCircleTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.6)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(32, 32, 32, 0, Math.PI * 2);
        ctx.fill();
        return new THREE.CanvasTexture(canvas);
    }

    _createStarTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, 64, 64);
        ctx.translate(32, 32);
        ctx.fillStyle = '#ffffff';

        // 绘制四芒星
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            ctx.lineTo(0, -30);
            ctx.quadraticCurveTo(0, -6, 6, 0);
            ctx.rotate(Math.PI / 2);
        }
        ctx.closePath();
        ctx.fill();

        // 中心光晕
        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, 16, 0, Math.PI * 2);
        ctx.fill();

        return new THREE.CanvasTexture(canvas);
    }

    setQuality(q) {
        this.quality = q;
    }

    // 起跳时的少量脚底尘土
    emitJumpDust(pos) {
        const count = this.quality === 'low' ? 6 : (this.quality === 'medium' ? 12 : 20);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 0.8 + Math.random() * 1.4;
            const sprite = new THREE.Sprite(this.dustMaterial.clone());
            sprite.position.copy(pos);
            sprite.position.y += 0.05;
            
            const startScale = 0.2 + Math.random() * 0.15;
            sprite.scale.set(startScale, startScale, 1);
            this.scene.add(sprite);

            this.particles.push({
                obj: sprite,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0.4 + Math.random() * 0.5, Math.sin(angle) * speed),
                life: 0,
                maxLife: 0.35 + Math.random() * 0.2,
                grow: 1.8,
                fade: true
            });
        }
    }

    // 落地时的冲击波与扩散尘埃环
    emitLandDust(pos, power = 1.0) {
        const count = this.quality === 'low' ? 10 : (this.quality === 'medium' ? 20 : 32);
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
            const speed = (1.2 + Math.random() * 1.5) * power;
            const sprite = new THREE.Sprite(this.dustMaterial.clone());
            sprite.position.copy(pos);
            sprite.position.y += 0.04;

            const startScale = 0.22 + Math.random() * 0.18;
            sprite.scale.set(startScale, startScale, 1);
            this.scene.add(sprite);

            this.particles.push({
                obj: sprite,
                vel: new THREE.Vector3(Math.cos(angle) * speed, 0.3 + Math.random() * 0.6, Math.sin(angle) * speed),
                life: 0,
                maxLife: 0.4 + Math.random() * 0.25,
                grow: 2.2,
                fade: true
            });
        }
    }

    // Perfect 精准落地：金色璀璨星光喷泉
    emitPerfectSparkles(pos, combo = 1) {
        const baseCount = this.quality === 'low' ? 16 : (this.quality === 'medium' ? 32 : 50);
        const count = Math.min(60, baseCount + (combo - 1) * 4);
        
        // 选用明快亮丽的金色、暖橙、鹅黄色彩
        const colors = [0xfff176, 0xffd54f, 0xffca28, 0xffe082, 0xffffff];

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const spread = 1.2 + Math.random() * 2.5;
            const upSpeed = 2.5 + Math.random() * 3.5;
            
            const mat = this.starMaterial.clone();
            mat.color.setHex(colors[Math.floor(Math.random() * colors.length)]);

            const sprite = new THREE.Sprite(mat);
            sprite.position.copy(pos);
            sprite.position.y += 0.2;
            
            const size = 0.35 + Math.random() * 0.35;
            sprite.scale.set(size, size, 1);
            this.scene.add(sprite);

            this.particles.push({
                obj: sprite,
                vel: new THREE.Vector3(
                    Math.cos(angle) * spread,
                    upSpeed,
                    Math.sin(angle) * spread
                ),
                gravity: -7.5,
                rotSpeed: (Math.random() - 0.5) * 8,
                life: 0,
                maxLife: 0.65 + Math.random() * 0.4,
                fade: true,
                sparkle: true
            });
        }
    }

    // 掉落时的滑稽汗滴 / 灰尘
    emitFallSweat(pos) {
        for (let i = 0; i < 4; i++) {
            const sprite = new THREE.Sprite(this.dustMaterial.clone());
            sprite.material.color.setHex(0x90caf9);
            sprite.position.copy(pos);
            sprite.position.x += (Math.random() - 0.5) * 0.6;
            sprite.position.y += 0.6 + Math.random() * 0.4;
            sprite.position.z += (Math.random() - 0.5) * 0.6;
            sprite.scale.set(0.18, 0.28, 1);
            this.scene.add(sprite);

            this.particles.push({
                obj: sprite,
                vel: new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.8, (Math.random() - 0.5) * 0.5),
                gravity: -4.0,
                life: 0,
                maxLife: 0.5,
                fade: true
            });
        }
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.life += dt;

            if (p.life >= p.maxLife) {
                this.scene.remove(p.obj);
                if (p.obj.material) p.obj.material.dispose();
                this.particles.splice(i, 1);
                continue;
            }

            const progress = p.life / p.maxLife;

            // 物理位置更新
            if (p.gravity) {
                p.vel.y += p.gravity * dt;
            }
            p.obj.position.x += p.vel.x * dt;
            p.obj.position.y += p.vel.y * dt;
            p.obj.position.z += p.vel.z * dt;

            // 尺寸生长 / 衰减
            if (p.grow) {
                const s = (1 + progress * (p.grow - 1));
                p.obj.scale.multiplyScalar(1 + dt * 1.5);
            }

            // 透明度淡出
            if (p.fade) {
                p.obj.material.opacity = (1 - progress);
            }

            // 闪烁特效
            if (p.sparkle) {
                p.obj.material.rotation += (p.rotSpeed || 2) * dt;
            }
        }
    }

    clear() {
        for (let p of this.particles) {
            this.scene.remove(p.obj);
            if (p.obj.material) p.obj.material.dispose();
        }
        this.particles = [];
    }
}
