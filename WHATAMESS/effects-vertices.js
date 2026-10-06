// version 20260926
// effets sur les VERTICES (sphères créées à partir du fichier .obj source)
// composants : vertices, vertices-desappear, vertices-falling, vertices-glitch
// events     : vertices, vertices-desappear, vertices-falling, vertices-glitch
//
// vertices-desappear, vertices-falling et vertices-glitch nécessitent le
// composant "vertices" sur la MÊME entité, et que l'event 'vertices' ait déjà
// été déclenché au moins une fois (pour que les sphères existent).

(function () {

    // anime l'opacité d'un matériau depuis sa valeur actuelle jusqu'à targetOpacity, en duration ms
    function animateOpacity(mat, targetOpacity, duration) {
        mat.transparent = true;
        var startOpacity = mat.opacity;
        var startTime = performance.now();

        function tick(now) {
            var t = Math.min((now - startTime) / duration, 1);
            mat.opacity = startOpacity + (targetOpacity - startOpacity) * t;
            mat.needsUpdate = true;
            if (t < 1) {
                requestAnimationFrame(tick);
            }
        }

        requestAnimationFrame(tick);
    }

    // ------------------------------------------------------------------
    // vertices
    // à l'event 'vertices' (toggle) :
    //   - rend le modèle transparent
    //   - lit le fichier .obj source comme du texte (fetch)
    //   - crée une sphère à chaque position de vertex
    // un second event 'vertices' retire les sphères et restaure l'opacité d'origine
    // paramètres : radius (0.001), color (white), opacity (0.15), ratio (1)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices', {
        schema: {
            radius: {
                type: 'number',
                default: 0.001
            },
            color: {
                type: 'color',
                default: '#ffffff'
            },
            opacity: {
                type: 'number',
                default: 0.15
            },
            ratio: {
                type: 'number',
                default: 1
            }
        },
        init: function () {
            var self = this;
            this.showing = false;
            this.group = null;
            this.sphereMaterial = null; // exposé pour vertices-desappear / vertices-glitch / vertices-falling
            this.verticesCache = null; // liste complète non filtrée
            this.originalOpacities = new Map();

            this.el.addEventListener('vertices', function () {
                if (self.showing) {
                    self.hideVertices();
                } else {
                    self.showVertices();
                }
            });
        },

        showVertices: function () {
            var self = this;

            this.setModelOpacity(this.data.opacity);

            if (this.verticesCache) {
                this.createSpheres(this.sampleVertices(this.verticesCache));
                this.showing = true;
                return;
            }

            var objUrl = this.getObjUrl();
            if (!objUrl) {
                console.warn("vertices : impossible de trouver l'URL du fichier .obj (vérifie l'attribut obj-model)");
                return;
            }

            fetch(objUrl)
                .then(function (res) {
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    return res.text();
                })
                .then(function (text) {
                    var vertices = self.parseVertices(text);
                    if (vertices.length === 0) {
                        console.warn("vertices : aucun vertex trouvé dans " + objUrl);
                        return;
                    }
                    self.verticesCache = vertices;
                    self.createSpheres(self.sampleVertices(vertices));
                    self.showing = true;
                })
                .catch(function (err) {
                    console.error("vertices : erreur de lecture de '" + objUrl + "'", err);
                });
        },

        hideVertices: function () {
            if (this.group) {
                this.el.object3D.remove(this.group);
            }
            this.restoreModelOpacity();
            this.showing = false;
        },

        getObjUrl: function () {
            var objModelData = this.el.getAttribute('obj-model');
            if (!objModelData || !objModelData.obj) return null;

            var obj = objModelData.obj;
            if (obj.charAt(0) === '#') {
                var assetEl = document.querySelector(obj);
                return assetEl ? assetEl.getAttribute('src') : null;
            }
            return obj;
        },

        parseVertices: function (text) {
            var vertices = [];
            var lines = text.split('\n');
            for (var i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.charAt(0) === 'v' && line.charAt(1) === ' ') {
                    var parts = line.trim().split(/\s+/);
                    var x = parseFloat(parts[1]);
                    var y = parseFloat(parts[2]);
                    var z = parseFloat(parts[3]);
                    if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
                        vertices.push(new THREE.Vector3(x, y, z));
                    }
                }
            }
            return vertices;
        },

        // répartition régulière (pas aléatoire) selon this.data.ratio, pour un échantillonnage
        // homogène sur toute la surface du modèle
        sampleVertices: function (vertices) {
            var ratio = this.data.ratio;
            if (ratio >= 1) return vertices;
            if (ratio <= 0) return [];

            var target = Math.max(1, Math.round(vertices.length * ratio));
            var step = vertices.length / target;
            var result = [];
            for (var i = 0; i < target; i++) {
                result.push(vertices[Math.floor(i * step)]);
            }
            return result;
        },

        createSpheres: function (vertices) {
            var data = this.data;
            var geometry = new THREE.SphereGeometry(data.radius, 6, 6);
            // depthTest: false + renderOrder élevé : évite le z-fighting avec la surface
            // semi-transparente du modèle (les sphères sont posées pile sur les vertices)
            var material = new THREE.MeshBasicMaterial({ color: data.color, depthTest: false });
            var group = new THREE.Group();

            vertices.forEach(function (v) {
                var sphere = new THREE.Mesh(geometry, material);
                sphere.position.copy(v);
                sphere.renderOrder = 999;
                sphere.userData.effectVerticesSphere = true;
                group.add(sphere);
            });

            this.group = group;
            this.sphereMaterial = material;
            this.el.object3D.add(group);

            console.log("vertices : " + vertices.length + " sphère(s) créée(s) sur '" + this.el.id + "'");
        },

        setModelOpacity: function (opacity) {
            var self = this;
            var processed = new Set();
            var found = false;

            this.el.object3D.traverse(function (node) {
                if (!node.isMesh || !node.material || node.userData.effectVerticesSphere) return;
                found = true;

                var materials = Array.isArray(node.material) ? node.material : [node.material];
                materials.forEach(function (mat) {
                    if (processed.has(mat.uuid)) return;
                    processed.add(mat.uuid);

                    if (!self.originalOpacities.has(mat.uuid)) {
                        self.originalOpacities.set(mat.uuid, { opacity: mat.opacity, transparent: mat.transparent });
                    }
                    mat.transparent = true;
                    mat.opacity = opacity;
                    mat.needsUpdate = true;
                });
            });

            if (!found) {
                console.warn("vertices : aucun mesh trouvé sur '" + this.el.id + "' (modèle pas encore chargé ?)");
            }
        },

        restoreModelOpacity: function () {
            var self = this;
            var processed = new Set();

            this.el.object3D.traverse(function (node) {
                if (!node.isMesh || !node.material || node.userData.effectVerticesSphere) return;

                var materials = Array.isArray(node.material) ? node.material : [node.material];
                materials.forEach(function (mat) {
                    if (processed.has(mat.uuid)) return;
                    processed.add(mat.uuid);

                    var original = self.originalOpacities.get(mat.uuid);
                    if (original) {
                        mat.opacity = original.opacity;
                        mat.transparent = original.transparent;
                        mat.needsUpdate = true;
                    }
                });
            });
        }
    });

    // ------------------------------------------------------------------
    // vertices-desappear — CUMULATIF
    // à combiner avec "vertices" sur la même entité.
    // à chaque event 'vertices-desappear', réduit l'opacité des sphères de "step" par
    // rapport à sa valeur ACTUELLE (pas de retour en arrière), avec un plancher "min".
    // paramètres : step (défaut 0.2), min (défaut 0), duration (défaut 2000)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-desappear', {
        schema: {
            step: {
                type: 'number',
                default: 0.2
            },
            min: {
                type: 'number',
                default: 0
            },
            duration: {
                type: 'number',
                default: 2000
            }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('vertices-desappear', function () {
                var verticesComp = el.components['vertices'];

                if (!verticesComp || !verticesComp.sphereMaterial) {
                    console.warn("vertices-desappear : pas de sphères trouvées sur '" + el.id +
                        "' (déclenche d'abord l'event 'vertices')");
                    return;
                }

                var mat = verticesComp.sphereMaterial;
                var target = Math.max(data.min, mat.opacity - data.step);
                animateOpacity(mat, target, data.duration);
            });
        }
    });

    // ------------------------------------------------------------------
    // vertices-falling
    // à combiner avec "vertices" sur la même entité.
    // à l'event 'vertices-falling', chaque sphère descend (position locale y) jusqu'à y=0
    // paramètres : duration (2000), destroy (false : supprime la sphère au sol)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-falling', {
        schema: {
            duration: {
                type: 'number',
                default: 2000
            },
            destroy: {
                type: 'boolean',
                default: false
            }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('vertices-falling', function () {
                var verticesComp = el.components['vertices'];

                if (!verticesComp || !verticesComp.group || verticesComp.group.children.length === 0) {
                    console.warn("vertices-falling : pas de sphères trouvées sur '" + el.id +
                        "' (déclenche d'abord l'event 'vertices')");
                    return;
                }

                var spheres = verticesComp.group.children.slice();
                spheres.forEach(function (sphere) {
                    animateFall(sphere, data.duration, data.destroy);
                });
            });
        }
    });

    function animateFall(sphere, duration, destroy) {
        var startY = sphere.position.y;
        var startTime = performance.now();

        function tick(now) {
            var t = Math.min((now - startTime) / duration, 1);
            sphere.position.y = startY + (0 - startY) * t;
            if (t < 1) {
                requestAnimationFrame(tick);
            } else if (destroy && sphere.parent) {
                sphere.parent.remove(sphere);
            }
        }

        requestAnimationFrame(tick);
    }

    // ------------------------------------------------------------------
    // vertices-glitch
    // à combiner avec "vertices" sur la même entité.
    // à l'event 'vertices-glitch', perturbation aléatoire et répétée des sphères
    // pendant "duration", puis retour à leur position d'origine
    // paramètres : amplitude (0.02), duration (800), frequency (60 sauts/s)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-glitch', {
        schema: {
            amplitude: {
                type: 'number',
                default: 0.02
            },
            duration: {
                type: 'number',
                default: 800
            },
            frequency: {
                type: 'number',
                default: 60
            }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('vertices-glitch', function () {
                var verticesComp = el.components['vertices'];

                if (!verticesComp || !verticesComp.group || verticesComp.group.children.length === 0) {
                    console.warn("vertices-glitch : pas de sphères trouvées sur '" + el.id +
                        "' (déclenche d'abord l'event 'vertices')");
                    return;
                }

                var spheres = verticesComp.group.children.map(function (sphere) {
                    return { sphere: sphere, origin: sphere.position.clone() };
                });

                runGlitch(spheres, data.amplitude, data.duration, data.frequency);
            });
        }
    });

    // ------------------------------------------------------------------
    // vertices-corrupt — CUMULATIF
    // à combiner avec "vertices" sur la même entité.
    // à chaque event 'vertices-corrupt', déplace INSTANTANÉMENT un nouveau lot de
    // sphères (parmi celles pas encore touchées), sans jamais restaurer les
    // précédentes — le bit-rot s'aggrave, il ne guérit pas. Une fois toutes les
    // sphères corrompues, l'effet est épuisé.
    // paramètres : percentage (défaut 0.1, proportion du TOTAL à chaque appel), amplitude (défaut 0.05)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-corrupt', {
        schema: {
            percentage: {
                type: 'number',
                default: 0.1
            },
            amplitude: {
                type: 'number',
                default: 0.05
            }
        },
        init: function () {
            var el = this.el;
            var data = this.data;
            var self = this;
            this.corruptedSet = new Set(); // sphères déjà touchées (par référence), jamais restaurées

            el.addEventListener('vertices-corrupt', function () {
                var verticesComp = el.components['vertices'];

                if (!verticesComp || !verticesComp.group || verticesComp.group.children.length === 0) {
                    console.warn("vertices-corrupt : pas de sphères trouvées sur '" + el.id +
                        "' (déclenche d'abord l'event 'vertices')");
                    return;
                }

                var allSpheres = verticesComp.group.children;
                var pool = allSpheres.filter(function (s) { return !self.corruptedSet.has(s); });

                if (pool.length === 0) {
                    console.warn("vertices-corrupt : toutes les sphères de '" + el.id + "' sont déjà corrompues");
                    return;
                }

                var count = Math.max(1, Math.min(pool.length, Math.round(allSpheres.length * data.percentage)));

                // mélange (Fisher-Yates) pour sélectionner "count" sphères au hasard dans le pool restant
                for (var i = pool.length - 1; i > 0; i--) {
                    var j = Math.floor(Math.random() * (i + 1));
                    var tmp = pool[i];
                    pool[i] = pool[j];
                    pool[j] = tmp;
                }
                var selected = pool.slice(0, count);

                selected.forEach(function (sphere) {
                    sphere.position.set(
                        sphere.position.x + (Math.random() * 2 - 1) * data.amplitude,
                        sphere.position.y + (Math.random() * 2 - 1) * data.amplitude,
                        sphere.position.z + (Math.random() * 2 - 1) * data.amplitude
                    );
                    self.corruptedSet.add(sphere);
                });

                console.log("vertices-corrupt : " + selected.length + " sphère(s) de plus corrompue(s) sur '" + el.id +
                    "' (" + self.corruptedSet.size + "/" + allSpheres.length + " au total)");
            });
        }
    });

    // ------------------------------------------------------------------
    // vertices-scatter
    // à combiner avec "vertices" sur la même entité.
    // à l'event 'vertices-scatter', chaque sphère monte et se disperse
    // horizontalement de façon aléatoire, comme de la cendre — dissolution
    // plutôt que chute (contraire de vertices-falling).
    // paramètres :
    //   duration (défaut 3000) : durée de la montée, en ms
    //   height   (défaut 0.5)  : distance de montée verticale (avec variation aléatoire)
    //   spread   (défaut 0.3)  : dispersion horizontale aléatoire max (x/z)
    //   destroy  (défaut true) : supprime la sphère une fois la dissolution terminée
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-scatter', {
        schema: {
            duration: {
                type: 'number',
                default: 3000
            },
            height: {
                type: 'number',
                default: 0.5
            },
            spread: {
                type: 'number',
                default: 0.3
            },
            destroy: {
                type: 'boolean',
                default: true
            }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('vertices-scatter', function () {
                var verticesComp = el.components['vertices'];

                if (!verticesComp || !verticesComp.group || verticesComp.group.children.length === 0) {
                    console.warn("vertices-scatter : pas de sphères trouvées sur '" + el.id +
                        "' (déclenche d'abord l'event 'vertices')");
                    return;
                }

                var spheres = verticesComp.group.children.slice();
                spheres.forEach(function (sphere) {
                    var target = new THREE.Vector3(
                        sphere.position.x + (Math.random() * 2 - 1) * data.spread,
                        sphere.position.y + data.height + Math.random() * data.height * 0.5,
                        sphere.position.z + (Math.random() * 2 - 1) * data.spread
                    );
                    animateScatter(sphere, target, data.duration, data.destroy);
                });
            });
        }
    });

    function animateScatter(sphere, target, duration, destroy) {
        var start = sphere.position.clone();
        var startTime = performance.now();

        function tick(now) {
            var t = Math.min((now - startTime) / duration, 1);
            sphere.position.lerpVectors(start, target, t);
            if (t < 1) {
                requestAnimationFrame(tick);
            } else if (destroy && sphere.parent) {
                sphere.parent.remove(sphere);
            }
        }

        requestAnimationFrame(tick);
    }

    // répartition régulière (pas aléatoire) selon ratio (0 à 1) — même logique que
    // la méthode sampleVertices du composant "vertices", dupliquée ici en fonction
    // autonome pour ne pas dépendre de son instance
    function sampleVertices(vertices, ratio) {
        if (ratio >= 1) return vertices;
        if (ratio <= 0) return [];

        var target = Math.max(1, Math.round(vertices.length * ratio));
        var step = vertices.length / target;
        var result = [];
        for (var i = 0; i < target; i++) {
            result.push(vertices[Math.floor(i * step)]);
        }
        return result;
    }

    // génère une texture canvas affichant un seul caractère ("0" ou "1")
    function createDigitTexture(digit, color) {
        var canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, 64, 64);
        ctx.fillStyle = color;
        ctx.font = 'bold 48px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(digit, 32, 34);
        return new THREE.CanvasTexture(canvas);
    }

    // ------------------------------------------------------------------
    // vertices-binary-rain — IDEMPOTENT, autonome
    // à combiner avec "vertices" sur la même entité (nécessite que l'event
    // 'vertices' ait déjà été déclenché, pour avoir les positions en cache).
    // à l'event 'vertices-binary-rain', affiche des sprites "0"/"1" aux positions
    // des vertices, qui tombent en boucle façon pluie Matrix pendant "lifetime" ms,
    // puis s'arrêtent d'elles-mêmes. Chaque rejeu tire un nouveau motif 0/1
    // statistiquement équivalent (idempotent). Un 2e event pendant que ça tombe
    // arrête tout immédiatement (raccourci manuel, en plus de la fin automatique).
    // paramètres :
    //   ratio    (défaut 0.1)    : proportion des vertices utilisés
    //   size     (défaut 0.05)   : taille des sprites
    //   color    (défaut #00ff00): couleur des chiffres
    //   distance (défaut 0.3)    : hauteur de chute avant de reboucler en haut
    //   duration (défaut 2000)   : temps (ms) pour parcourir "distance"
    //   lifetime (défaut 4000)   : durée totale avant arrêt automatique (0 = infini)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-binary-rain', {
        schema: {
            ratio: {
                type: 'number',
                default: 0.1
            },
            size: {
                type: 'number',
                default: 0.05
            },
            color: {
                type: 'color',
                default: '#00ff00'
            },
            distance: {
                type: 'number',
                default: 0.3
            },
            duration: {
                type: 'number',
                default: 2000
            },
            lifetime: {
                type: 'number',
                default: 4000
            }
        },
        init: function () {
            var self = this;
            this.showing = false;
            this.group = null;
            this.rafId = null;
            this.lastTime = null;
            this.lifetimeTimeout = null;

            this.el.addEventListener('vertices-binary-rain', function () {
                if (self.showing) {
                    self.stop();
                } else {
                    self.start();
                }
            });
        },
        start: function () {
            var el = this.el;
            var data = this.data;
            var self = this;

            var verticesComp = el.components['vertices'];
            if (!verticesComp || !verticesComp.verticesCache) {
                console.warn("vertices-binary-rain : pas de vertices en cache sur '" + el.id +
                    "' (déclenche d'abord l'event 'vertices')");
                return;
            }

            var vertices = sampleVertices(verticesComp.verticesCache, data.ratio);

            var tex0 = createDigitTexture('0', data.color);
            var tex1 = createDigitTexture('1', data.color);
            var mat0 = new THREE.SpriteMaterial({ map: tex0, transparent: true, depthTest: false });
            var mat1 = new THREE.SpriteMaterial({ map: tex1, transparent: true, depthTest: false });

            var group = new THREE.Group();

            vertices.forEach(function (v) {
                var mat = Math.random() < 0.5 ? mat0 : mat1;
                var sprite = new THREE.Sprite(mat);
                sprite.scale.set(data.size, data.size, 1);
                sprite.position.copy(v);
                sprite.renderOrder = 999;
                sprite.userData.startY = v.y;
                sprite.userData.offset = Math.random() * data.distance; // décalage aléatoire, chute non synchronisée
                group.add(sprite);
            });

            this.group = group;
            el.object3D.add(group);
            this.showing = true;

            var fallSpeed = data.distance / data.duration; // unités par ms
            this.lastTime = performance.now();

            function tick(now) {
                var deltaMs = now - self.lastTime;
                self.lastTime = now;

                group.children.forEach(function (sprite) {
                    sprite.userData.offset += fallSpeed * deltaMs;
                    if (sprite.userData.offset > data.distance) {
                        sprite.userData.offset -= data.distance;
                    }
                    sprite.position.y = sprite.userData.startY - sprite.userData.offset;
                });

                self.rafId = requestAnimationFrame(tick);
            }

            this.rafId = requestAnimationFrame(tick);

            if (data.lifetime > 0) {
                this.lifetimeTimeout = setTimeout(function () { self.stop(); }, data.lifetime);
            }

            console.log("vertices-binary-rain : " + vertices.length + " chiffre(s) en chute sur '" + el.id + "'");
        },
        stop: function () {
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            if (this.lifetimeTimeout) {
                clearTimeout(this.lifetimeTimeout);
                this.lifetimeTimeout = null;
            }
            if (this.group) {
                this.el.object3D.remove(this.group);
                this.group = null;
            }
            this.showing = false;
        }
    });

    // ------------------------------------------------------------------
    // vertices-erosion
    // à combiner avec "vertices" sur la même entité.
    // à l'event 'vertices-erosion', un pourcentage de sphères disparaît
    // INSTANTANÉMENT chacune, mais à des instants étalés (et légèrement
    // irréguliers) sur toute la durée — l'usure du temps plutôt qu'une
    // commande unique. Aller simple, pas de toggle.
    // paramètres :
    //   duration   (défaut 5000) : durée totale de l'érosion, en ms
    //   percentage (défaut 1.0)  : proportion des sphères qui finissent par disparaître
    //   jitter     (défaut 0.3)  : irrégularité du rythme (0 = métronomique)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('vertices-erosion', {
        schema: {
            duration: {
                type: 'number',
                default: 5000
            },
            percentage: {
                type: 'number',
                default: 1.0
            },
            jitter: {
                type: 'number',
                default: 0.3
            }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('vertices-erosion', function () {
                var verticesComp = el.components['vertices'];

                if (!verticesComp || !verticesComp.group || verticesComp.group.children.length === 0) {
                    console.warn("vertices-erosion : pas de sphères trouvées sur '" + el.id +
                        "' (déclenche d'abord l'event 'vertices')");
                    return;
                }

                var spheres = verticesComp.group.children.slice();

                // mélange (Fisher-Yates) : ordre d'érosion aléatoire
                for (var i = spheres.length - 1; i > 0; i--) {
                    var j = Math.floor(Math.random() * (i + 1));
                    var tmp = spheres[i];
                    spheres[i] = spheres[j];
                    spheres[j] = tmp;
                }

                var count = Math.max(1, Math.round(spheres.length * data.percentage));
                var toErode = spheres.slice(0, count);
                var interval = data.duration / count;

                toErode.forEach(function (sphere, index) {
                    var jitterOffset = (Math.random() * 2 - 1) * interval * data.jitter;
                    var delay = Math.max(0, index * interval + jitterOffset);
                    setTimeout(function () {
                        if (sphere.parent) sphere.parent.remove(sphere);
                    }, delay);
                });

                console.log("vertices-erosion : " + count + " sphère(s) vont s'effacer sur " + data.duration + "ms");
            });
        }
    });

    function runGlitch(spheres, amplitude, duration, frequency) {
        var startTime = performance.now();
        var interval = 1000 / frequency;
        var nextJumpTime = startTime;

        function tick(now) {
            var elapsed = now - startTime;

            if (elapsed >= duration) {
                spheres.forEach(function (item) {
                    item.sphere.position.copy(item.origin);
                });
                return;
            }

            if (now >= nextJumpTime) {
                spheres.forEach(function (item) {
                    item.sphere.position.set(
                        item.origin.x + (Math.random() * 2 - 1) * amplitude,
                        item.origin.y + (Math.random() * 2 - 1) * amplitude,
                        item.origin.z + (Math.random() * 2 - 1) * amplitude
                    );
                });
                nextJumpTime = now + interval;
            }

            requestAnimationFrame(tick);
        }

        requestAnimationFrame(tick);
    }

})();
