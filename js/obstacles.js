/**
 * 《奶蛙跳一跳》 - 障碍物与空中干扰系统 (Obstacle System)
 * 实现低多边形飞鸟 / 地狱烈焰蝙蝠的生成、翼动飞行动画、巡航轨迹与空中碰撞击飞判定
 */

class ObstacleManager {
    constructor(scene) {
        this.scene = scene;
        this.birds = [];
        this.isHellMode = false;
        this.spawnTimer = 0;
        this.baseSpawnInterval = 5.2; // 默认飞鸟生成间隔 (秒)
        this.hellSpawnInterval = 2.1; // 地狱模式更频繁暴走 (秒)
        this.hitRadius = 0.72; // 碰撞检测半径 (米)
    }

    setHellMode(enabled) {
        if (this.isHellMode === enabled) return;
        this.isHellMode = !!enabled;

        // 对现有飞鸟进行地狱火化变异
        for (const bird of this.birds) {
            this._applyHellMaterial(bird);
        }
    }

    reset() {
        this.clear();
        this.spawnTimer = 1.8; // 开局略微延迟后出现第一只飞鸟
        this.isHellMode = false;
    }

    clear() {
        for (const bird of this.birds) {
            this.scene.remove(bird.group);
            if (bird.shadow) this.scene.remove(bird.shadow);
        }
        this.birds = [];
    }

    /**
     * 依据当前与目标平台生成穿行于空域的飞鸟
     */
    spawnBird(curPlatform, nextPlatform) {
        if (!curPlatform || !nextPlatform) return;

        // 飞鸟穿梭于两平台中点上空
        const midPoint = new THREE.Vector3().addVectors(curPlatform.center, nextPlatform.center).multiplyScalar(0.5);

        // 跳跃主轴方向
        const jumpDir = new THREE.Vector3().subVectors(nextPlatform.center, curPlatform.center).normalize();
        jumpDir.y = 0;

        // 垂直于跳跃方向的横穿轴 (左到右或右到左)
        const crossDir = new THREE.Vector3(-jumpDir.z, 0, jumpDir.x).normalize();
        const flyFromLeft = Math.random() > 0.5;
        const flightDist = 14.0; // 横穿空域跨度

        // 高度位于奶蛙跳跃抛物线的中上段 (1.4m ~ 2.8m)
        const altitude = 1.35 + Math.random() * 1.45;

        const startPos = midPoint.clone()
            .addScaledVector(crossDir, flyFromLeft ? -flightDist * 0.5 : flightDist * 0.5);
        startPos.y = altitude;

        const endPos = midPoint.clone()
            .addScaledVector(crossDir, flyFromLeft ? flightDist * 0.5 : -flightDist * 0.5);
        endPos.y = altitude + (Math.random() - 0.5) * 0.6; // 微量高度起伏

        // 飞行速度
        const speed = this.isHellMode ? (5.8 + Math.random() * 2.2) : (3.6 + Math.random() * 1.5);
        const flightDuration = startPos.distanceTo(endPos) / speed;

        // 构建飞鸟 3D 模型
        const birdGroup = this._createBirdMesh(this.isHellMode);
        birdGroup.position.copy(startPos);
        birdGroup.lookAt(endPos);

        // 地面柔和阴影投影
        const shadowGeo = new THREE.CircleGeometry(0.35, 12);
        shadowGeo.rotateX(-Math.PI / 2);
        const shadowMat = new THREE.MeshBasicMaterial({
            color: this.isHellMode ? 0x660000 : 0x223322,
            transparent: true,
            opacity: this.isHellMode ? 0.45 : 0.22,
            depthWrite: false
        });
        const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
        shadowMesh.position.set(startPos.x, 0.05, startPos.z);

        this.scene.add(birdGroup);
        this.scene.add(shadowMesh);

        this.birds.push({
            group: birdGroup,
            shadow: shadowMesh,
            startPos,
            endPos,
            speed,
            progress: 0,
            duration: flightDuration,
            wingSpeed: this.isHellMode ? 26 : 16,
            leftWing: birdGroup.userData.leftWing,
            rightWing: birdGroup.userData.rightWing,
            isHell: this.isHellMode,
            hit: false
        });
    }

    _createBirdMesh(isHell) {
        const group = new THREE.Group();

        // 身体
        const bodyGeo = new THREE.ConeGeometry(0.24, 0.62, 5);
        bodyGeo.rotateX(Math.PI / 2); // 尖端朝前

        const bodyMat = new THREE.MeshStandardMaterial({
            color: isHell ? 0x8a0b0b : 0xe6f4f1,
            roughness: 0.4,
            metalness: isHell ? 0.3 : 0.1,
            emissive: isHell ? 0x5a0000 : 0x112211,
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.castShadow = true;
        group.add(body);

        // 鸟喙 / 獠牙
        const beakGeo = new THREE.ConeGeometry(0.09, 0.26, 4);
        beakGeo.rotateX(Math.PI / 2);
        const beakMat = new THREE.MeshBasicMaterial({
            color: isHell ? 0xff4400 : 0xffaa00
        });
        const beak = new THREE.Mesh(beakGeo, beakMat);
        beak.position.set(0, 0, 0.36);
        group.add(beak);

        // 眼睛
        const eyeGeo = new THREE.SphereGeometry(0.045, 6, 6);
        const eyeMat = new THREE.MeshBasicMaterial({
            color: isHell ? 0xff2200 : 0x111111
        });
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(0.12, 0.08, 0.18);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(-0.12, 0.08, 0.18);
        group.add(leftEye);
        group.add(rightEye);

        // 翅膀支点与低模扇动羽翼
        const wingShape = new THREE.BoxGeometry(0.48, 0.03, 0.26);
        wingShape.translate(0.24, 0, 0); // 将旋转原点设在内侧关节

        const wingMat = new THREE.MeshStandardMaterial({
            color: isHell ? 0x550000 : 0x77b5d9,
            roughness: 0.5,
            emissive: isHell ? 0x330000 : 0x000000,
            flatShading: true
        });

        // 左翼
        const leftWingPivot = new THREE.Group();
        leftWingPivot.position.set(0.12, 0.05, 0);
        const leftWingMesh = new THREE.Mesh(wingShape, wingMat);
        leftWingPivot.add(leftWingMesh);
        group.add(leftWingPivot);

        // 右翼
        const rightWingPivot = new THREE.Group();
        rightWingPivot.position.set(-0.12, 0.05, 0);
        const rightWingMesh = new THREE.Mesh(wingShape, wingMat);
        rightWingMesh.scale.x = -1; // 对称镜像
        rightWingPivot.add(rightWingMesh);
        group.add(rightWingPivot);

        group.userData = {
            body,
            leftWing: leftWingPivot,
            rightWing: rightWingPivot,
            bodyMat,
            wingMat,
            eyeMat
        };

        return group;
    }

    _applyHellMaterial(bird) {
        if (!bird.group || !bird.group.userData) return;
        const ud = bird.group.userData;
        if (ud.bodyMat) {
            ud.bodyMat.color.setHex(0x8a0b0b);
            ud.bodyMat.emissive.setHex(0x660000);
        }
        if (ud.wingMat) {
            ud.wingMat.color.setHex(0x550000);
            ud.wingMat.emissive.setHex(0x440000);
        }
        if (ud.eyeMat) {
            ud.eyeMat.color.setHex(0xff1100);
        }
        if (bird.shadow && bird.shadow.material) {
            bird.shadow.material.color.setHex(0x660000);
            bird.shadow.material.opacity = 0.5;
        }
        bird.isHell = true;
        bird.wingSpeed = 26;
    }

    /**
     * 核心每帧更新：位移巡航、翅膀煽动、碰撞击飞检测
     */
    update(dt, curPlatform, nextPlatform, playerWorldPos, isJumping, onHitCallback) {
        // 1. 动态生成逻辑
        const interval = this.isHellMode ? this.hellSpawnInterval : this.baseSpawnInterval;
        this.spawnTimer += dt;
        if (this.spawnTimer >= interval) {
            this.spawnTimer = 0;
            // 保持场上最多 3 只飞鸟 (地狱模式最多 5 只)
            const maxBirds = this.isHellMode ? 5 : 3;
            if (this.birds.length < maxBirds && curPlatform && nextPlatform) {
                this.spawnBird(curPlatform, nextPlatform);
            }
        }

        // 2. 存活飞鸟更新
        const timeNow = performance.now() * 0.001;
        for (let i = this.birds.length - 1; i >= 0; i--) {
            const b = this.birds[i];
            b.progress += dt / b.duration;

            if (b.progress >= 1.0) {
                // 飞越完成，移出场景
                this.scene.remove(b.group);
                if (b.shadow) this.scene.remove(b.shadow);
                this.birds.splice(i, 1);
                continue;
            }

            // 线性插值推进位置，叠加极微弱正弦波上下滑翔
            const pos = new THREE.Vector3().lerpVectors(b.startPos, b.endPos, b.progress);
            pos.y += Math.sin(b.progress * Math.PI * 4) * 0.18;
            b.group.position.copy(pos);

            // 更新地面阴影
            if (b.shadow) {
                b.shadow.position.x = pos.x;
                b.shadow.position.z = pos.z;
                // 越高阴影越淡、越宽
                const heightRatio = Math.max(0.1, pos.y);
                const scale = 1.0 + heightRatio * 0.25;
                b.shadow.scale.set(scale, scale, scale);
                b.shadow.material.opacity = Math.max(0.08, 0.35 - heightRatio * 0.08);
            }

            // 翅膀煽动动画
            const flap = Math.sin(timeNow * b.wingSpeed) * 0.65;
            if (b.leftWing) b.leftWing.rotation.z = flap;
            if (b.rightWing) b.rightWing.rotation.z = -flap;

            // 3. 空中跳跃碰撞检测 (只有在奶蛙处于起跳滞空状态且飞鸟未命中过时触发)
            if (isJumping && !b.hit && playerWorldPos) {
                const dist = b.group.position.distanceTo(playerWorldPos);
                if (dist <= this.hitRadius) {
                    b.hit = true;
                    // 飞鸟受击翻滚脱离
                    b.speed *= 1.8;
                    b.group.rotation.x += Math.PI * 0.5;

                    // 计算撞飞推力矢量：由飞鸟飞行冲力向奶蛙施加侧向与下坠冲量
                    const flyForward = new THREE.Vector3().subVectors(b.endPos, b.startPos).normalize();
                    const knockDir = flyForward.clone().multiplyScalar(0.7).add(new THREE.Vector3(0, -0.3, 0)).normalize();

                    if (typeof onHitCallback === 'function') {
                        onHitCallback(b, knockDir);
                    }
                }
            }
        }
    }
}
