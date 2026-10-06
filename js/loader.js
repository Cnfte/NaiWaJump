/**
 * 《奶蛙跳一跳》 - 智能多模态 3D 模型加载器
 * 优先使用预打包数据 / 本地 GLB，同时支持 Drag & Drop 拖入 zip / glb，并提供友好的安全策略提示
 */
class ModelLoader {
    constructor(onProgress = () => {}, onLoaded = () => {}, onError = () => {}) {
        this.onProgress = onProgress;
        this.onLoaded = onLoaded;
        this.onError = onError;
        this.gltfLoader = new THREE.GLTFLoader();
    }

    // 启动智能加载
    load() {
        this.onProgress(0.1, '正在准备奶蛙模型...');

        // 策略 1: 检查是否已通过 model_data.js 注入 Base64 数据 (实现 file:// 协议 0 配置秒开)
        if (window.NAIWA_MODEL_B64 && window.NAIWA_MODEL_B64.length > 100) {
            this.onProgress(0.3, '解析本地预置模型数据...');
            try {
                const buffer = this._base64ToArrayBuffer(window.NAIWA_MODEL_B64);
                this.onProgress(0.6, '构建 3D 几何与材质贴图...');
                this.gltfLoader.parse(
                    buffer,
                    '',
                    (gltf) => {
                        this.onProgress(1.0, '模型加载完成！');
                        this.onLoaded(gltf.scene);
                    },
                    (err) => {
                        console.warn('Base64 模型解析失败，尝试备用方案:', err);
                        this._tryFetchGLB();
                    }
                );
                return;
            } catch (e) {
                console.warn('Base64 转换失败:', e);
            }
        }

        // 策略 2: 尝试 HTTP fetch 加载本地 naiwa.glb
        this._tryFetchGLB();
    }

    _tryFetchGLB() {
        this.onProgress(0.4, '从目录加载 naiwa.glb...');
        this.gltfLoader.load(
            'naiwa.glb',
            (gltf) => {
                this.onProgress(1.0, '模型加载成功！');
                this.onLoaded(gltf.scene);
            },
            (xhr) => {
                if (xhr.lengthComputable && xhr.total > 0) {
                    const p = 0.4 + (xhr.loaded / xhr.total) * 0.55;
                    this.onProgress(p, `正在加载模型 (${Math.round(p * 100)}%)...`);
                }
            },
            (err) => {
                console.warn('直接加载 naiwa.glb 失败:', err);
                this.onError({
                    type: 'CORS_OR_FILE',
                    message: '浏览器安全策略 (file://) 限制直接读取外部文件。'
                });
            }
        );
    }

    // 处理用户拖拽或选择的文件 (.glb / .gltf / .zip)
    handleFile(file) {
        const name = file.name.toLowerCase();
        this.onProgress(0.2, `正在读取文件: ${file.name}...`);

        if (name.endsWith('.glb')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.gltfLoader.parse(
                    e.target.result,
                    '',
                    (gltf) => {
                        this.onProgress(1.0, '加载完成！');
                        this.onLoaded(gltf.scene);
                    },
                    (err) => this.onError({ type: 'PARSE_ERROR', error: err })
                );
            };
            reader.readAsArrayBuffer(file);
        } else if (name.endsWith('.zip')) {
            this._handleZipFile(file);
        } else {
            alert('请上传 .glb 或 naiwa.zip 文件！');
        }
    }

    async _handleZipFile(file) {
        if (!window.JSZip) {
            alert('JSZip 库未就绪');
            return;
        }

        try {
            this.onProgress(0.3, '正在解压并读取 zip 资源包...');
            const zip = await JSZip.loadAsync(file);

            // 搜索 zip 内的 glb 或 fbx
            let glbFile = null;
            zip.forEach((path, entry) => {
                if (path.toLowerCase().endsWith('.glb')) {
                    glbFile = entry;
                }
            });

            if (glbFile) {
                this.onProgress(0.6, `解压模型 ${glbFile.name}...`);
                const buffer = await glbFile.async('arraybuffer');
                this.gltfLoader.parse(
                    buffer,
                    '',
                    (gltf) => {
                        this.onProgress(1.0, '解压并加载完成！');
                        this.onLoaded(gltf.scene);
                    },
                    (err) => this.onError({ type: 'PARSE_ERROR', error: err })
                );
            } else {
                alert('zip 文件中未包含 .glb 模型。已自动切换为预置奶蛙模型。');
                this.load();
            }
        } catch (e) {
            console.error('解压失败:', e);
            alert('解压 zip 失败: ' + e.message);
        }
    }

    _base64ToArrayBuffer(base64) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}
