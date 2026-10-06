// version 20260927
// effets sur le MODÈLE 3D lui-même (obj-model / gltf-model)
// composants : model-wireframe, model-transparent, model-desappear, model-bluescreen, model-reboot, model-delete
// events     : wireframe,       transparent,       desappear,       bluescreen,       reboot,       delete
//
// convention de rejeu (issue de la réflexion sur la vanité numérique) : la plupart de
// ces effets ne sont plus des toggles réversibles. Rejouer l'event aggrave la
// dégradation (CUMULATIF) ou n'a plus d'effet une fois la ressource épuisée
// (DESTRUCTIF) — cohérent avec l'idée qu'une vanité ne revient pas en arrière.
//   - model-wireframe  : CUMULATIF (un matériau de plus en fil de fer à chaque appel)
//   - model-transparent: CUMULATIF (opacité qui descend par paliers depuis sa valeur actuelle)
//   - model-desappear  : IDEMPOTENT (aller-retour complet et autonome à chaque appel)
//   - model-bluescreen : DESTRUCTIF (panne définitive, un seul aller)
//   - model-reboot     : CUMULATIF puis DESTRUCTIF (tentatives de plus en plus faibles,
//                        échec définitif après "attempts" tentatives ; attempts:1 = échec immédiat)
//   - model-delete     : DESTRUCTIF (suppression définitive)

(function () {

    // anime l'opacité d'un matériau depuis sa valeur actuelle jusqu'à targetOpacity, en
    // duration ms ; callback optionnel appelé à la fin de la transition
    function animateOpacity(mat, targetOpacity, duration, callback) {
        mat.transparent = true;
        var startOpacity = mat.opacity;
        var startTime = performance.now();

        function tick(now) {
            var t = Math.min((now - startTime) / duration, 1);
            mat.opacity = startOpacity + (targetOpacity - startOpacity) * t;
            mat.needsUpdate = true;
            if (t < 1) {
                requestAnimationFrame(tick);
            } else if (callback) {
                callback();
            }
        }

        requestAnimationFrame(tick);
    }

    // récupère la liste dédoublonnée (par uuid) des matériaux d'une entité
    function collectMaterials(el) {
        var materials = [];
        var processed = new Set();
        var found = false;

        el.object3D.traverse(function (node) {
            if (!node.isMesh || !node.material) return;
            found = true;
            var mats = Array.isArray(node.material) ? node.material : [node.material];
            mats.forEach(function (mat) {
                if (processed.has(mat.uuid)) return;
                processed.add(mat.uuid);
                materials.push(mat);
            });
        });

        return { materials: materials, found: found };
    }

    // ------------------------------------------------------------------
    // model-wireframe — CUMULATIF
    // à chaque event 'wireframe', bascule UN matériau supplémentaire (parmi ceux pas
    // encore touchés) en mode fil de fer. Le modèle se "déshabille" morceau par
    // morceau. Une fois tous les matériaux passés en wireframe, l'effet est épuisé.
    // schema "color" (optionnel) : force une couleur de wireframe
    // ------------------------------------------------------------------
    AFRAME.registerComponent('model-wireframe', {
        schema: {
            color: { type: 'color', default: '' }
        },
        init: function () {
            var el = this.el;
            var self = this;
            this.queue = null; // matériaux pas encore passés en wireframe (init paresseuse)

            el.addEventListener('wireframe', function () {
                if (self.queue === null) {
                    var res = collectMaterials(el);
                    if (!res.found) {
                        console.warn("model-wireframe : aucun mesh trouvé sur '" + el.id + "' (modèle pas encore chargé ?)");
                        return;
                    }
                    self.queue = res.materials;
                }

                if (self.queue.length === 0) {
                    console.warn("model-wireframe : tous les matériaux de '" + el.id + "' sont déjà en wireframe");
                    return;
                }

                var mat = self.queue.shift();
                mat.wireframe = true;
                if (self.data.color && mat.color) {
                    mat.color.set(self.data.color);
                }
                mat.needsUpdate = true;

                console.log("model-wireframe : 1 matériau de plus en wireframe sur '" + el.id +
                    "' (" + self.queue.length + " restant(s))");
            });
        }
    });

    // ------------------------------------------------------------------
    // model-transparent — CUMULATIF
    // à chaque event 'transparent', réduit l'opacité de "step" par rapport à sa
    // valeur ACTUELLE (pas un retour à 1), avec un plancher "min".
    // paramètres : step (défaut 0.2), min (défaut 0.05)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('model-transparent', {
        schema: {
            step: { type: 'number', default: 0.2 },
            min: { type: 'number', default: 0.05 }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('transparent', function () {
                var res = collectMaterials(el);
                if (!res.found) {
                    console.warn("model-transparent : aucun mesh trouvé sur '" + el.id + "' (modèle pas encore chargé ?)");
                    return;
                }

                res.materials.forEach(function (mat) {
                    mat.transparent = true;
                    mat.opacity = Math.max(data.min, mat.opacity - data.step);
                    mat.needsUpdate = true;
                });
            });
        }
    });

    // ------------------------------------------------------------------
    // model-desappear — IDEMPOTENT
    // à chaque event 'desappear', anime l'opacité jusqu'à "opacity" puis revient
    // automatiquement à 1 : un aller-retour complet et autonome à chaque appel
    // (plus besoin d'un 2e event pour revenir).
    // paramètres : opacity (défaut 0.3), duration (défaut 2000, par trajet)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('model-desappear', {
        schema: {
            opacity: { type: 'number', default: 0.3 },
            duration: { type: 'number', default: 2000 }
        },
        init: function () {
            var el = this.el;
            var data = this.data;

            el.addEventListener('desappear', function () {
                var res = collectMaterials(el);
                if (!res.found) {
                    console.warn("model-desappear : aucun mesh trouvé sur '" + el.id + "' (modèle pas encore chargé ?)");
                    return;
                }

                res.materials.forEach(function (mat) {
                    animateOpacity(mat, data.opacity, data.duration, function () {
                        animateOpacity(mat, 1, data.duration);
                    });
                });
            });
        }
    });

    // ------------------------------------------------------------------
    // model-bluescreen — DESTRUCTIF
    // à l'event 'bluescreen' : flash bref d'une couleur d'alerte, puis extinction
    // BRUTALE et DÉFINITIVE. Un rejeu une fois le crash survenu n'a plus d'effet —
    // une panne matérielle ne se répare pas toute seule.
    // paramètres : color (défaut #0000aa), duration (défaut 400 : durée du flash)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('model-bluescreen', {
        schema: {
            color: { type: 'color', default: '#0000aa' },
            duration: { type: 'number', default: 400 }
        },
        init: function () {
            var el = this.el;
            var data = this.data;
            var self = this;
            this.crashed = false;

            el.addEventListener('bluescreen', function () {
                if (self.crashed) {
                    console.warn("model-bluescreen : '" + el.id + "' a déjà crashé, plus rien à faire");
                    return;
                }

                var res = collectMaterials(el);
                if (!res.found) {
                    console.warn("model-bluescreen : aucun mesh trouvé sur '" + el.id + "' (modèle pas encore chargé ?)");
                    return;
                }

                res.materials.forEach(function (mat) {
                    if (mat.color) mat.color.set(data.color);
                    mat.needsUpdate = true;
                });

                setTimeout(function () {
                    res.materials.forEach(function (mat) {
                        mat.transparent = true;
                        mat.opacity = 0;
                        mat.needsUpdate = true;
                    });
                    self.crashed = true;
                    console.log("model-bluescreen : '" + el.id + "' a crashé définitivement");
                }, data.duration);
            });
        }
    });

    // ------------------------------------------------------------------
    // model-reboot — CUMULATIF puis DESTRUCTIF
    // à chaque event 'reboot' : clignotement (vieil écran qui agonise), un peu plus
    // dégradé à chaque tentative (fréquence plus basse, clignotement plus long).
    // Après "attempts" tentatives, le redémarrage échoue définitivement (extinction
    // permanente). Avec attempts: 1, la toute première tentative échoue déjà
    // (destructif immédiat, comme demandé).
    // paramètres :
    //   duration  (défaut 2000) : durée du clignotement de la 1ère tentative, en ms
    //   frequency (défaut 8)    : clignotements/s au départ de la 1ère tentative
    //   slowdown  (défaut true) : ralentit le clignotement en fin de tentative
    //   attempts  (défaut 3)    : nombre de tentatives avant panne définitive
    //                             (1 = échec dès le premier appel, 0 = jamais de panne)
    // ------------------------------------------------------------------
    AFRAME.registerComponent('model-reboot', {
        schema: {
            duration: { type: 'number', default: 2000 },
            frequency: { type: 'number', default: 8 },
            slowdown: { type: 'boolean', default: true },
            attempts: { type: 'number', default: 3 }
        },
        init: function () {
            var el = this.el;
            var data = this.data;
            var self = this;
            this.attemptCount = 0;
            this.dead = false;

            el.addEventListener('reboot', function () {
                if (self.dead) {
                    console.warn("model-reboot : '" + el.id + "' est définitivement en panne");
                    return;
                }

                self.attemptCount++;
                var maxAttempts = data.attempts > 0 ? data.attempts : Infinity;
                var isLastAttempt = self.attemptCount >= maxAttempts;

                // dégradation progressive : fréquence plus basse et clignotement plus
                // long à mesure que les tentatives s'accumulent (0 -> 1)
                var wear = Math.min(self.attemptCount / maxAttempts, 1);
                var degradedFrequency = Math.max(1, data.frequency * (1 - wear * 0.7));
                var degradedDuration = data.duration * (1 + wear);

                self.runReboot(degradedDuration, degradedFrequency, data.slowdown, isLastAttempt);
            });
        },
        runReboot: function (duration, frequency, slowdown, willDie) {
            var el = this.el;
            var self = this;
            var startTime = performance.now();
            var baseInterval = 1000 / frequency;

            el.object3D.visible = true;

            function blink() {
                var elapsed = performance.now() - startTime;

                if (elapsed >= duration) {
                    if (willDie) {
                        el.object3D.visible = false;
                        self.dead = true;
                        console.log("model-reboot : '" + el.id + "' ne redémarre plus (tentative " +
                            self.attemptCount + ")");
                    } else {
                        el.object3D.visible = true;
                        console.log("model-reboot : '" + el.id + "' redémarre (tentative " +
                            self.attemptCount + ")");
                    }
                    return;
                }

                el.object3D.visible = !el.object3D.visible;

                var nextInterval = baseInterval;
                if (slowdown) {
                    var t = elapsed / duration;
                    nextInterval = baseInterval * (1 + t * 4);
                }

                setTimeout(blink, nextInterval);
            }

            blink();
        }
    });

    // ------------------------------------------------------------------
    // model-delete — DESTRUCTIF
    // au premier event 'delete', supprime définitivement l'entité (géométrie et
    // matériaux libérés). Un rejeu n'a plus rien à supprimer.
    // pas de paramètre
    // ------------------------------------------------------------------
    AFRAME.registerComponent('model-delete', {
        init: function () {
            var el = this.el;
            var self = this;
            this.deleted = false;

            el.addEventListener('delete', function () {
                if (self.deleted) {
                    console.warn("model-delete : '" + el.id + "' est déjà supprimé");
                    return;
                }

                el.object3D.traverse(function (node) {
                    if (node.isMesh) {
                        if (node.geometry) node.geometry.dispose();
                        if (node.material) {
                            var mats = Array.isArray(node.material) ? node.material : [node.material];
                            mats.forEach(function (mat) { mat.dispose(); });
                        }
                    }
                });

                el.object3D.visible = false;
                self.deleted = true;
                console.log("model-delete : '" + el.id + "' supprimé définitivement");
            });
        }
    });

})();
