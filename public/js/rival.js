/**
 * 《奶蛙跳一跳》 - 1v1 多人对战 3D 对手幽灵奶蛙 (Rival Ghost Frog)
 * 在同一 3D 世界中实时呈现对手的蓄力、起跳、滑翔抛物线、着陆缓冲与掉落状态
 * 采用全息幽灵荧光材质与头顶悬浮名牌看板 (3D Billboard Nameplate)
 */

class NaiwaRival {
    constructor(scene) {
        this.scene = scene;
        this.group = new THREE.Group();
        this.group.visible = false;
        this.scene.add(this.group);

        this.modelContainer = new THREE.Group();
        this.group.add(this.modelContainer);

        this.model = null;
        this.nameplate = null;
        this.isLoaded = false;

        // 状态: 'IDLE' | 'CHARGING' | 'JUMPING' | 'LANDED' | 'FALLING'
        this.state = 'IDLE';
        this.alive = true;

        // 平滑插值目标与物理参数
        this.targetPos = new THREE.Vector3();
        this.currentPos = new THREE.Vector3();
        this.chargeRatio = 0;

        // 跳跃平滑插值
        this.isJumping = false;
        this.jumpStartPos = new THREE.Vector3();
        this.jumpEndPos = new THREE.Vector3();
        this.jumpProgress = 0;
        this.jumpDuration = 0.6;
        this.jumpArcHeight = 2.0;

        // 掉落物理
        this.fallVel = new THREE.Vector3();
        this.fallRotVel = new THREE.Vector3();

        // 呼吸计时
        this.time = 0;
    }

    /**
     * 从主玩家模型深拷贝生成对手 3D 模型，并赋予炫酷的全息对手材质
     */
    initFromPlayerModel(playerModel) {
        if (!playerModel) return;

        if (this.model) {
            this.modelContainer.remove(this.model);
        }

        // 深克隆玩家的网格结构
        this.model = playerModel.clone(true);
        this.modelContainer.add(this.model);

        // 赋予对手半透明幻影材质 (幽灵紫与幻境青荧光)
        this.model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = false; // 幽灵不投射重阴影
                child.receiveShadow = false;

                const rivalMat = new THREE.MeshStandardMaterial({
                    color: 0x9c27b0, // 幻影紫色
                    roughness: 0.3,
                    metalness: 0.2,
                    transparent: true,
                    opacity: 0.82,
                    emissive: 0x4a148c,
                    emissiveIntensity: 0.45
                });
                child.material = rivalMat;
            }
        });

        // 创建头顶悬浮名牌
        this._createNameplate('对手: 寻找中...');
        this.isLoaded = true;
    }

    /**
     * 生成 3D Billboard 头顶名牌或动态对话气泡
     */
    _createNameplate(text, strokeColor = '#c084fc') {
        if (this.nameplate) {
            this.group.remove(this.nameplate);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 440;
        canvas.height = 104;
        const ctx = canvas.getContext('2d');

        // 背景胶囊
        ctx.fillStyle = 'rgba(24, 28, 36, 0.9)';
        ctx.beginPath();
        ctx.roundRect(16, 16, 408, 72, 36);
        ctx.fill();

        // 边框流光
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 4;
        ctx.stroke();

        // 文本
        ctx.font = 'bold 28px "PingFang SC", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 220, 52);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        this.nameplate = new THREE.Sprite(spriteMat);
        this.nameplate.scale.set(2.6, 0.65, 1);
        this.nameplate.position.set(0, 1.85, 0); // 浮在奶蛙头部上方
        this.group.add(this.nameplate);
    }

    setOpponentName(name, score = 0) {
        this.opponentName = name;
        this.opponentScore = score;
        const displayName = `⚔️ ${name.slice(0, 8)} (${score})`;
        this._createNameplate(displayName, '#c084fc');
    }

    showSpeechBubble(text) {
        if (!text) return;
        const bubbleText = `💬 ${text.slice(0, 15)}`;
        this._createNameplate(bubbleText, '#f43f5e');

        if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
        this.bubbleTimer = setTimeout(() => {
            if (this.opponentName) {
                this.setOpponentName(this.opponentName, this.opponentScore || 0);
            }
        }, 3400);
    }

    setHellMode(enabled) {
        if (!this.model) return;
        this.model.traverse((child) => {
            if (child.isMesh && child.material) {
                if (enabled) {
                    child.material.color.setHex(0xff3300);
                    child.material.emissive.setHex(0xaa0000);
                    child.material.emissiveIntensity = 0.7;
                } else {
                    child.material.color.setHex(0x9c27b0);
                    child.material.emissive.setHex(0x4a148c);
                    child.material.emissiveIntensity = 0.45;
                }
            }
        });
    }

    setVisible(val) {
        this.group.visible = !!val;
    }

    resetTo(pos, facingTarget = null) {
        this.currentPos.copy(pos);
        this.group.position.copy(pos);
        this.group.position.y = 0;
        this.modelContainer.scale.set(1, 1, 1);
        this.modelContainer.rotation.set(0, 0, 0);
        this.state = 'IDLE';
        this.alive = true;
        this.isJumping = false;
        this.chargeRatio = 0;

        if (facingTarget) {
            const dir = new THREE.Vector3().subVectors(facingTarget, pos);
            dir.y = 0;
            if (dir.lengthSq() > 0.001) {
                const angle = Math.atan2(dir.x, dir.z);
                this.group.rotation.y = angle;
            }
        }
    }

    /**
     * 接收服务端同步过来的对手遥测数据并平滑映射
     */
    syncTelemetry(oppTelemetry, currentTargetPos) {
        if (!oppTelemetry) return;

        // 更新名牌分数
        if (oppTelemetry.name) {
            this.setOpponentName(oppTelemetry.name, oppTelemetry.score || 0);
        }

        // 掉落状态同步
        if (oppTelemetry.alive === false || oppTelemetry.state === 'FALLING') {
            if (this.alive) {
                this.alive = false;
                this.triggerFall();
            }
            return;
        }

        // 蓄力形变同步
        if (oppTelemetry.charge !== undefined && oppTelemetry.state === 'CHARGING') {
            this.state = 'CHARGING';
            this.chargeRatio = oppTelemetry.charge;
            return;
        }

        // 位置与跳跃插值
        if (oppTelemetry.pos) {
            const serverPos = new THREE.Vector3(oppTelemetry.pos.x, oppTelemetry.pos.y, oppTelemetry.pos.z);
            const dist = this.group.position.distanceTo(serverPos);

            if (dist > 0.8 && !this.isJumping) {
                // 如果对手跳跃到了新位置，触发平滑飞跃动画
                this.launchJumpTo(serverPos);
            } else if (!this.isJumping) {
                this.group.position.lerp(serverPos, 0.25);
            }
        }

        if (currentTargetPos) {
            const dir = new THREE.Vector3().subVectors(currentTargetPos, this.group.position);
            dir.y = 0;
            if (dir.lengthSq() > 0.001) {
                const targetAngle = Math.atan2(dir.x, dir.z);
                this.group.rotation.y = THREE.MathUtils.lerp(this.group.rotation.y, targetAngle, 0.15);
            }
        }
    }

    launchJumpTo(targetPos) {
        this.isJumping = true;
        this.jumpStartPos.copy(this.group.position);
        this.jumpEndPos.copy(targetPos);
        this.jumpEndPos.y = 0;
        this.jumpProgress = 0;
        this.state = 'JUMPING';
    }

    triggerFall() {
        this.state = 'FALLING';
        this.fallVel.set((Math.random() - 0.5) * 1.5, 2.5, (Math.random() - 0.5) * 1.5);
        this.fallRotVel.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
    }

    update(delta) {
        if (!this.group.visible) return;
        this.time += delta;

        // 1. 掉落物理模拟
        if (this.state === 'FALLING') {
            this.fallVel.y -= 19.8 * delta;
            this.group.position.x += this.fallVel.x * delta;
            this.group.position.y += this.fallVel.y * delta;
            this.group.position.z += this.fallVel.z * delta;

            this.modelContainer.rotation.x += this.fallRotVel.x * delta;
            this.modelContainer.rotation.z += this.fallRotVel.z * delta;

            // 跌入虚空渐隐
            if (this.group.position.y < -12) {
                this.group.visible = false;
            }
            return;
        }

        // 2. 跳跃抛物线运动
        if (this.isJumping) {
            this.jumpProgress += delta / this.jumpDuration;
            const t = Math.min(1.0, this.jumpProgress);

            this.group.position.x = THREE.MathUtils.lerp(this.jumpStartPos.x, this.jumpEndPos.x, t);
            this.group.position.z = THREE.MathUtils.lerp(this.jumpStartPos.z, this.jumpEndPos.z, t);

            // 抛物线高度计算：4 * h * t * (1 - t)
            const arcH = 4 * this.jumpArcHeight * t * (1 - t);
            this.group.position.y = Math.max(0, arcH);

            if (t >= 1.0) {
                this.isJumping = false;
                this.group.position.y = 0;
                this.state = 'LANDED';
                setTimeout(() => {
                    if (this.state === 'LANDED') this.state = 'IDLE';
                }, 200);
            }
            return;
        }

        // 3. 蓄力形变
        if (this.state === 'CHARGING') {
            const squish = 1.0 - this.chargeRatio * 0.32;
            const bulge = 1.0 + this.chargeRatio * 0.22;
            this.modelContainer.scale.set(bulge, squish, bulge);
            return;
        }

        // 4. 待机浮动呼吸
        const breath = Math.sin(this.time * 2.8) * 0.02;
        this.modelContainer.scale.set(1 + breath, 1 - breath, 1 + breath);
    }
}
