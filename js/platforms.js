/**
 * 《奶蛙跳一跳》 - 3D 平台生成与落点判定系统
 * 具有多种马卡龙风格主题台、黄金奖励台、同心圆落点靶心与动态难度曲线
 */
class PlatformManager {
    constructor(scene) {
        this.scene = scene;
        this.platforms = [];
        this.currentIndex = 0;
        this.nextIndex = 1;

        // 柔和而鲜明可爱的马卡龙糖果与奶油质感配色表
        this.colorPalette = [
            { body: 0x6cd8bb, ring: 0x2fa585, name: '薄荷苏打' },
            { body: 0xffb380, ring: 0xff7043, name: '蜜桃奶油' },
            { body: 0x64c8f5, ring: 0x1e88e5, name: '晴空冰沙' },
            { body: 0xffcb42, ring: 0xf57c00, name: '元气芒果' },
            { body: 0x9be068, ring: 0x689f38, name: '抹茶豆乳' },
            { body: 0xdc9bf2, ring: 0xab47bc, name: '梦幻香芋' },
            { body: 0x7de0dc, ring: 0x00acc1, name: '海盐冰淇淋' }
        ];

        // 共享材质缓存以提升绘制效率
        this.materials = new Map();
    }

    _getMaterial(color, isGold = false) {
        const key = `${color}_${isGold}`;
        if (!this.materials.has(key)) {
            const mat = new THREE.MeshStandardMaterial({
                color: isGold ? 0xffd700 : color,
                roughness: isGold ? 0.35 : 0.65,
                metalness: isGold ? 0.5 : 0.08,
                flatShading: false
            });
            this.materials.set(key, mat);
        }
        return this.materials.get(key);
    }

    // 重置并初始化前两个平台
    reset() {
        this.clear();
        this.currentIndex = 0;
        this.nextIndex = 1;

        // 起点平台 (稳健大台)
        const p0 = this._createPlatform(0, new THREE.Vector3(0, 0, 0), 1.35, 'cylinder', false);
        this.platforms.push(p0);

        // 第一个目标平台 (正前方稍带随机，初始距离适中友好)
        const firstDist = 4.2;
        const p1Pos = new THREE.Vector3(0, 0, -firstDist);
        const p1 = this._createPlatform(1, p1Pos, 1.3, 'cylinder', false);
        this.platforms.push(p1);

        // 预生成第三个平台，让视野自然延展
        this.spawnNextPlatform();
    }

    // 根据当前积分与平台序号计算难度
    _calcDifficulty(step) {
        // 前 10 步保持简单
        const factor = Math.min(1.0, Math.max(0, (step - 5) / 45));
        
        // 距离随进度增加：从 3.8 ~ 4.8 渐增到 5.5 ~ 8.0 (跳跃极限蓄力可达 10.5)
        const minDist = 3.8 + factor * 1.6;
        const maxDist = 4.8 + factor * 3.2;
        const distance = minDist + Math.random() * (maxDist - minDist);

        // 平台半径随进度从 1.35 逐渐微缩到 0.95
        const baseRadius = 1.32 - factor * 0.35;
        const radius = Math.max(0.9, baseRadius + (Math.random() - 0.5) * 0.2);

        return { distance, radius };
    }

    // 生成下一个平台
    spawnNextPlatform() {
        const lastPlatform = this.platforms[this.platforms.length - 1];
        const step = lastPlatform.index + 1;
        const diff = this._calcDifficulty(step);

        // 平台方向：前进步进，夹角在 -35度 到 +35度 之间，保证一直向前延伸
        // 每两次做一次左偏或右偏转向，增加多样的立体折线动感
        const baseAngle = -Math.PI / 2; // 向 -Z 延伸
        const angleSpread = 0.55; // 约 32 度
        const angleOffset = (Math.random() - 0.5) * 2 * angleSpread;
        const finalAngle = baseAngle + angleOffset;

        const offsetX = Math.cos(finalAngle) * diff.distance;
        const offsetZ = Math.sin(finalAngle) * diff.distance;

        const nextPos = new THREE.Vector3(
            lastPlatform.mesh.position.x + offsetX,
            0,
            lastPlatform.mesh.position.z + offsetZ
        );

        // 随机平台形态与类型 (圆柱台 / 圆角方台 / 蛋糕台 / 黄金台)
        let shape = 'cylinder';
        const rand = Math.random();
        if (rand < 0.45) {
            shape = 'cylinder';
        } else if (rand < 0.8) {
            shape = 'box';
        } else {
            shape = 'tiered';
        }

        // 约 8% 概率生成稀有黄金加分平台
        const isGold = (step > 3 && Math.random() < 0.08);
        const radius = isGold ? Math.max(1.15, diff.radius) : diff.radius;

        const platform = this._createPlatform(step, nextPos, radius, shape, isGold);
        this.platforms.push(platform);

        // 清理老旧平台（保持场景中平台数量精简，节约内存与渲染开销）
        while (this.platforms.length > 5) {
            const old = this.platforms.shift();
            this.scene.remove(old.mesh);
            this.currentIndex = Math.max(0, this.currentIndex - 1);
            this.nextIndex = Math.max(0, this.nextIndex - 1);
        }

        return platform;
    }

    _createPlatform(index, pos, radius, shapeType, isGold) {
        const group = new THREE.Group();
        group.position.copy(pos);

        const colorScheme = this.colorPalette[index % this.colorPalette.length];
        const height = 1.4;
        const topY = 0; // 顶面严格在世界坐标 Y = 0 (或者群组内的顶面是 0)

        const bodyMat = this._getMaterial(colorScheme.body, isGold);
        const ringMat = this._getMaterial(isGold ? 0xffffff : colorScheme.ring, isGold);

        let mainMesh;

        if (shapeType === 'cylinder') {
            // 圆柱形台座
            const geo = new THREE.CylinderGeometry(radius, radius * 1.08, height, 32);
            mainMesh = new THREE.Mesh(geo, bodyMat);
            mainMesh.position.y = -height / 2;
        } else if (shapeType === 'box') {
            // 方形台座 (带稍宽底座)
            const side = radius * 1.85;
            const geo = new THREE.BoxGeometry(side, height, side);
            mainMesh = new THREE.Mesh(geo, bodyMat);
            mainMesh.position.y = -height / 2;
        } else {
            // 阶梯蛋糕形台座 (Tiered)
            const geoBottom = new THREE.CylinderGeometry(radius * 1.15, radius * 1.25, height * 0.5, 32);
            const bottomMesh = new THREE.Mesh(geoBottom, bodyMat);
            bottomMesh.position.y = -height * 0.75;
            bottomMesh.castShadow = true;
            bottomMesh.receiveShadow = true;
            group.add(bottomMesh);

            const geoTop = new THREE.CylinderGeometry(radius, radius, height * 0.5, 32);
            mainMesh = new THREE.Mesh(geoTop, bodyMat);
            mainMesh.position.y = -height * 0.25;
        }

        mainMesh.castShadow = true;
        mainMesh.receiveShadow = true;
        group.add(mainMesh);

        // 顶面同心靶心光环（既美观有童趣，又能指引玩家瞄准 PERFECT 中心点）
        const ringRadius = radius * 0.38;
        const ringGeo = new THREE.RingGeometry(ringRadius * 0.75, ringRadius, 32);
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = -Math.PI / 2;
        ringMesh.position.y = 0.005; // 略微浮于顶面，防止 Z-fighting
        ringMesh.receiveShadow = false;
        group.add(ringMesh);

        // 中心小圆点
        const dotGeo = new THREE.CircleGeometry(radius * 0.12, 24);
        const dotMesh = new THREE.Mesh(dotGeo, ringMat);
        dotMesh.rotation.x = -Math.PI / 2;
        dotMesh.position.y = 0.006;
        dotMesh.receiveShadow = false;
        group.add(dotMesh);

        // 黄金奖励台特别加持发光粒子小星星/皇冠指示
        if (isGold) {
            const starGeo = new THREE.OctahedronGeometry(0.2, 0);
            const starMat = new THREE.MeshStandardMaterial({
                color: 0xfff700,
                emissive: 0xffd700,
                emissiveIntensity: 0.6,
                roughness: 0.2
            });
            const star = new THREE.Mesh(starGeo, starMat);
            star.position.set(0, 0.45, 0);
            group.add(star);
            group.userData.starMesh = star;
        }

        // 台子入场微动动画参数
        group.position.y = -1.2; // 从下方微弱弹起登场
        group.userData = {
            targetY: 0,
            animProgress: 0,
            starMesh: group.userData.starMesh
        };

        this.scene.add(group);

        return {
            index,
            mesh: group,
            radius,
            shapeType,
            isGold,
            center: pos.clone()
        };
    }

    getCurrentPlatform() {
        return this.platforms[this.currentIndex];
    }

    getNextPlatform() {
        return this.platforms[this.nextIndex];
    }

    // 落地评级检测核心算法
    evaluateLanding(playerWorldPos) {
        const target = this.getNextPlatform();
        if (!target) return { grade: 'fall', dist: 999 };

        const targetCenter = target.center;
        // 计算水平 2D 欧几里得距离
        const dx = playerWorldPos.x - targetCenter.x;
        const dz = playerWorldPos.z - targetCenter.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const R = target.radius;

        // 与判定阈值对比 (R 为平台物理半径，稍微超出 1.05R 即判为滑落坠下)
        if (dist <= R * 0.28) {
            return { grade: 'perfect', dist, target, bonus: target.isGold ? 25 : 0 };
        } else if (dist <= R * 0.58) {
            return { grade: 'great', dist, target, bonus: target.isGold ? 15 : 0 };
        } else if (dist <= R * 0.88) {
            return { grade: 'good', dist, target, bonus: target.isGold ? 10 : 0 };
        } else if (dist <= R * 1.04) {
            return { grade: 'normal', dist, target, bonus: 0 };
        } else {
            return { grade: 'fall', dist, target, bonus: 0 };
        }
    }

    advance() {
        this.currentIndex++;
        this.nextIndex++;
        this.spawnNextPlatform();
    }

    update(dt) {
        // 平台登场弹簧平滑缓冲
        for (let p of this.platforms) {
            if (p.mesh.position.y < p.mesh.userData.targetY) {
                p.mesh.position.y += (p.mesh.userData.targetY - p.mesh.position.y) * 12 * dt;
                if (Math.abs(p.mesh.userData.targetY - p.mesh.position.y) < 0.005) {
                    p.mesh.position.y = p.mesh.userData.targetY;
                }
            }
            if (p.mesh.userData.starMesh) {
                p.mesh.userData.starMesh.rotation.y += 2.0 * dt;
                p.mesh.userData.starMesh.position.y = 0.45 + Math.sin(Date.now() * 0.005) * 0.08;
            }
        }
    }

    clear() {
        for (let p of this.platforms) {
            this.scene.remove(p.mesh);
        }
        this.platforms = [];
    }
}
