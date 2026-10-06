/**
 * 《奶蛙跳一跳》 - 主角“奶蛙”控制器
 * 包含模型自适应归一化、地面对齐、全套程序化弹力动画 (Idle呼吸、蓄力蓄势下压、起跳拉伸、空中抛物线姿态、着陆弹簧缓冲、坠落翻滚)
 */
class NaiwaPlayer {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.scene.add(this.group);

        this.modelContainer = new THREE.Group();
        this.group.add(this.modelContainer);

        this.model = null;
        this.isLoaded = false;

        // 状态机: 'IDLE' | 'CHARGING' | 'JUMPING' | 'LANDED' | 'FALLING'
        this.state = 'IDLE';

        // 跳跃抛物线运动参数
        this.startPos = new THREE.Vector3();
        this.targetPos = new THREE.Vector3();
        this.jumpProgress = 0;
        this.jumpDuration = 0.6;
        this.jumpArcHeight = 2.0;

        // 蓄力参数
        this.chargeRatio = 0;

        // 弹簧阻尼回弹系统 (落地与形变恢复)
        this.springScale = new THREE.Vector3(1, 1, 1);
        this.springVel = new THREE.Vector3(0, 0, 0);

        // 坠落物理参数
        this.fallVel = new THREE.Vector3();
        this.fallRotVel = new THREE.Vector3();

        // 呼吸计时器
        this.time = 0;
    }

    // 设置并适配 3D 模型
    setModel(gltfScene) {
        if (this.model) {
            this.modelContainer.remove(this.model);
        }

        this.model = gltfScene;
        this.modelContainer.add(this.model);

        // 1. 遍历计算原始模型的精确 BoundingBox
        const bbox = new THREE.Box3().setFromObject(this.model);
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        // 2. 自动归一化缩放：使奶蛙的长度约为 1.25 个游戏单位，高度适中
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetScale = 1.3 / (maxDim || 1.0);
        this.model.scale.set(targetScale, targetScale, targetScale);

        // 3. 再次获取缩放后的 BoundingBox，确保底部与 Y=0 完美贴合，中心在 (0, 0)
        const adjustedBBox = new THREE.Box3().setFromObject(this.model);
        this.model.position.x = -center.x * targetScale;
        this.model.position.z = -center.z * targetScale;
        this.model.position.y = -adjustedBBox.min.y; // 脚底严格对齐在 Y = 0

        // 4. 优化材质与阴影：保证柔和可爱的奶油黄色调与清晰阴影
        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                if (child.material) {
                    child.material.roughness = 0.65;
                    child.material.metalness = 0.05;
                    if (child.material.map) {
                        child.material.map.encoding = THREE.sRGBEncoding;
                    }
                }
            }
        });

        this.isLoaded = true;
        this.resetTo(new THREE.Vector3(0, 0, 0));
    }

    // 重置玩家到指定位置
    resetTo(pos, facingTarget = null) {
        this.group.position.copy(pos);
        this.group.position.y = 0; // 站在平台顶面
        this.springScale.set(1, 1, 1);
        this.springVel.set(0, 0, 0);
        this.modelContainer.scale.set(1, 1, 1);
        this.modelContainer.rotation.set(0, 0, 0);
        this.state = 'IDLE';
        this.chargeRatio = 0;

        if (facingTarget) {
            this.lookAtTarget(facingTarget);
        } else {
            // 默认面朝 -Z 方向 (前进方向)
            this.group.rotation.y = 0;
        }
    }

    // 面向目标点
    lookAtTarget(targetPos) {
        const dx = targetPos.x - this.group.position.x;
        const dz = targetPos.z - this.group.position.z;
        // 模型正面朝 -Z，故当朝着 (dx, dz) 时：
        const angle = Math.atan2(dx, -dz);
        this.group.rotation.y = angle;
    }

    // 开始蓄力
    startCharging() {
        if (this.state !== 'IDLE' && this.state !== 'LANDED') return;
        this.state = 'CHARGING';
        this.chargeRatio = 0;
    }

    // 更新蓄力比例 (0.0 ~ 1.0)
    setChargeRatio(ratio) {
        if (this.state !== 'CHARGING') return;
        this.chargeRatio = Math.max(0, Math.min(1.0, ratio));

        // 蓄势下压形变：Y 轴压缩，XZ 轴略微膨胀保持体积感，身体微微后坐
        const squashY = 1.0 - this.chargeRatio * 0.28;
        const stretchXZ = 1.0 + this.chargeRatio * 0.16;

        this.springScale.set(stretchXZ, squashY, stretchXZ);
        // 后坐微倾角
        this.modelContainer.rotation.x = -this.chargeRatio * 0.12;
    }

    // 执行起跳
    launch(jumpVector, arcHeight, duration) {
        this.state = 'JUMPING';
        this.startPos.copy(this.group.position);
        this.targetPos.copy(this.group.position).add(jumpVector);
        this.jumpProgress = 0;
        this.jumpDuration = duration;
        this.jumpArcHeight = arcHeight;

        // 起跳瞬间瞬间垂直拉伸！
        this.springScale.set(0.85, 1.35, 0.85);
        this.springVel.set(0, -3.0, 0); // 弹簧准备回缩
    }

    // 成功着陆缓冲
    onLanded(actualLandingPos) {
        this.state = 'LANDED';
        this.group.position.copy(actualLandingPos);
        this.group.position.y = 0;

        // 落地冲击：顿挫下压形变
        this.springScale.set(1.22, 0.72, 1.22);
        this.springVel.set(-2.0, 4.0, -2.0); // 强力弹簧反弹
        this.modelContainer.rotation.x = 0;
    }

    // 踏空掉落
    triggerFall(fallDirection) {
        this.state = 'FALLING';
        // 赋予掉落速度与翻滚角速度
        this.fallVel.set(fallDirection.x * 1.5, 0.5, fallDirection.z * 1.5);
        this.fallRotVel.set(
            (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 6
        );
    }

    update(dt) {
        this.time += dt;

        // 1. 状态特定逻辑
        if (this.state === 'IDLE' || this.state === 'LANDED') {
            // 待机轻微呼吸起伏动画 (柔和无骨骼程序动画)
            const breathe = Math.sin(this.time * 3.2) * 0.025;
            this.modelContainer.scale.y = this.springScale.y + breathe;
            this.modelContainer.scale.x = this.springScale.x - breathe * 0.5;
            this.modelContainer.scale.z = this.springScale.z - breathe * 0.5;
            this.modelContainer.position.y = Math.abs(breathe) * 0.04;
        } else if (this.state === 'CHARGING') {
            // 蓄力抖动/紧绷感
            const tremble = (Math.random() - 0.5) * 0.015 * this.chargeRatio;
            this.modelContainer.scale.copy(this.springScale);
            this.modelContainer.position.x = tremble;
            this.modelContainer.position.z = tremble;
        } else if (this.state === 'JUMPING') {
            this.jumpProgress += dt / this.jumpDuration;

            if (this.jumpProgress >= 1.0) {
                this.jumpProgress = 1.0;
            }

            const p = this.jumpProgress;

            // 水平位置线性插值
            this.group.position.x = THREE.MathUtils.lerp(this.startPos.x, this.targetPos.x, p);
            this.group.position.z = THREE.MathUtils.lerp(this.startPos.z, this.targetPos.z, p);

            // 竖直位置抛物线： 4 * H * p * (1 - p)
            this.group.position.y = 4 * this.jumpArcHeight * p * (1 - p);

            // 空中姿态变化：
            // 前半段起跳前倾，最高点水平，后半段前倾俯冲向平台
            const pitchAngle = Math.sin(p * Math.PI) * 0.35 * (1 - 2 * p);
            this.modelContainer.rotation.x = pitchAngle;

            // 空中形变从拉伸逐渐平复
            this.modelContainer.scale.copy(this.springScale);
        } else if (this.state === 'FALLING') {
            // 自由落体与失重倾倒翻转
            this.fallVel.y -= 22 * dt; // 重力加速度
            this.group.position.addScaledVector(this.fallVel, dt);

            this.modelContainer.rotation.x += this.fallRotVel.x * dt;
            this.modelContainer.rotation.y += this.fallRotVel.y * dt;
            this.modelContainer.rotation.z += this.fallRotVel.z * dt;
        }

        // 2. 弹簧阻尼器系统 (让受击、起跳、落地等形变弹性平滑恢复到 1.0)
        if (this.state !== 'CHARGING') {
            const k = 160; // 弹簧劲度系数
            const d = 16;  // 阻尼系数

            // X 轴
            const forceX = -k * (this.springScale.x - 1.0) - d * this.springVel.x;
            this.springVel.x += forceX * dt;
            this.springScale.x += this.springVel.x * dt;

            // Y 轴
            const forceY = -k * (this.springScale.y - 1.0) - d * this.springVel.y;
            this.springVel.y += forceY * dt;
            this.springScale.y += this.springVel.y * dt;

            // Z 轴
            const forceZ = -k * (this.springScale.z - 1.0) - d * this.springVel.z;
            this.springVel.z += forceZ * dt;
            this.springScale.z += this.springVel.z * dt;

            if (this.state !== 'IDLE' && this.state !== 'LANDED') {
                this.modelContainer.scale.copy(this.springScale);
            }
        }
    }

    getWorldPosition() {
        return this.group.position.clone();
    }
}
