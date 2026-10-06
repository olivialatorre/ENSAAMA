// version 20260927
// scheduler : orchestre dans le temps les events des librairies effects-model.js
// et effects-vertices.js (ou tout autre event A-Frame).
//
// composant : scheduler
// events écoutés (sur l'entité qui porte le composant) : start, stop, pause, resume
//
// principe :
//   - une "timeline" de cues à des instants précis (scénario fixe, façon partition)
//   - une couche "random" de règles périodiques : à intervalle régulier (+ jitter),
//     un event est tiré au sort dans un pool et envoyé à une cible
//   - une horloge interne unique basée sur requestAnimationFrame (pas des setTimeout
//     empilés) : pause/resume se résument à suspendre/reprendre l'avancement de
//     cette horloge, sans avoir à recalculer les délais restants de chaque timer
//
// ATTENTION : la plupart des events des 2 librairies sont des TOGGLES (un 2e envoi
// annule le 1er). Le scheduler se contente d'émettre l'event demandé ; c'est au
// scénario (le JSON) de tenir compte de cette parité.
//
// ------------------------------------------------------------------
// format du JSON de configuration (attribut "config") :
//
// {
//   "target": "#chair",              // cible par défaut, si une cue ne précise pas la sienne
//   "timeline": [
//     { "time": 0,     "event": "wireframe" },
//     { "time": 8000,  "event": "transparent" },
//     { "time": 20000, "target": "#chair", "event": "vertices" },
//     { "time": 45000, "event": "bluescreen" }
//   ],
//   "random": [
//     { "events": ["vertices-glitch"], "interval": 4000, "jitter": 0.5 },
//     { "target": "#chair", "events": ["vertices-corrupt", "vertices-scatter"],
//       "interval": 6000, "jitter": 0.3 }
//   ]
// }
//
// - "target" : sélecteur CSS (#id ou .classe, .classe envoie l'event à tous les
//   éléments trouvés). Peut être défini au niveau racine (défaut) et/ou par cue.
// - "timeline" : cues à sens unique, déclenchées une fois l'instant "time" (ms
//   depuis le démarrage) atteint.
// - "random" : règles périodiques. À chaque intervalle ("interval" ms, +/- "jitter"
//   en proportion, ex 0.3 = +/-30%), un event est tiré au sort dans "events" et
//   envoyé à "target". Avec un seul event dans le pool, ça revient à un simple
//   déclenchement périodique irrégulier.
// ------------------------------------------------------------------

(function () {

    AFRAME.registerComponent('scheduler', {
        schema: {
            config: {
                type: 'string',
                default: ''
            }, // sélecteur (#id d'un <script type="application/json">) OU JSON inline
            duration: {
                type: 'number',
                default: 60000
            }, // durée totale du scénario, en ms
            loop: {
                type: 'boolean',
                default: false
            },
            autostart: {
                type: 'boolean',
                default: true
            }
        },

        init: function () {
            var self = this;

            this.playing = false;
            this.clock = 0; // temps écoulé "actif" (hors pause), en ms
            this.lastFrameTime = null;
            this.rafId = null;
            this.timeline = []; // [{time, target, event, fired}]
            this.randomRules = []; // [{target, events, interval, jitter, nextFire}]

            this.el.addEventListener('start', function () { self.start(); });
            this.el.addEventListener('stop', function () { self.stop(); });
            this.el.addEventListener('pause', function () { self.pause(); });
            this.el.addEventListener('resume', function () { self.resume(); });

            this.loadConfig();

            if (this.data.autostart) {
                if (this.el.sceneEl.hasLoaded) {
                    this.start();
                } else {
                    this.el.sceneEl.addEventListener('loaded', function () { self.start(); });
                }
            }
        },

        // lit l'attribut "config" : soit un sélecteur vers un <script type="application/json">,
        // soit une chaîne JSON directement inline
        loadConfig: function () {
            var raw = this.data.config;
            if (!raw) {
                console.warn("scheduler : aucun attribut 'config' fourni sur '" + this.el.id + "'");
                return;
            }

            var text = raw;
            if (raw.charAt(0) === '#' || raw.charAt(0) === '.') {
                var el = document.querySelector(raw);
                if (!el) {
                    console.warn("scheduler : élément '" + raw + "' introuvable pour la config");
                    return;
                }
                text = el.textContent;
            }

            var json;
            try {
                json = JSON.parse(text);
            } catch (err) {
                console.error("scheduler : JSON invalide dans la config de '" + this.el.id + "'", err);
                return;
            }

            var defaultTarget = json.target || null;

            this.timeline = (json.timeline || []).map(function (cue) {
                return {
                    time: cue.time,
                    target: cue.target || defaultTarget,
                    event: cue.event,
                    fired: false
                };
            }).sort(function (a, b) { return a.time - b.time; });

            this.randomRules = (json.random || []).map(function (rule) {
                return {
                    target: rule.target || defaultTarget,
                    events: rule.events || [],
                    interval: rule.interval || 1000,
                    jitter: (typeof rule.jitter === 'number') ? rule.jitter : 0,
                    nextFire: 0 // recalculé au start()
                };
            });

            var missingTarget = this.timeline.some(function (c) { return !c.target; }) ||
                this.randomRules.some(function (r) { return !r.target; });
            if (missingTarget) {
                console.warn("scheduler : au moins une cue/règle n'a pas de 'target' (ni propre, ni par défaut)");
            }
        },

        start: function () {
            var self = this;

            this.clock = 0;
            this.timeline.forEach(function (cue) { cue.fired = false; });
            this.randomRules.forEach(function (rule) {
                // léger décalage aléatoire de départ pour éviter que toutes les règles
                // ne se déclenchent en même temps au premier tour
                rule.nextFire = rule.interval * (0.3 + Math.random() * 0.7);
            });

            this.playing = true;
            this.lastFrameTime = performance.now();
            this.rafId = requestAnimationFrame(function (t) { self.tick(t); });

            console.log("scheduler : démarrage sur '" + this.el.id + "' (durée " + this.data.duration + "ms)");
        },

        stop: function () {
            this.playing = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
            this.el.emit('scheduler-ended');
            console.log("scheduler : arrêt sur '" + this.el.id + "'");
        },

        pause: function () {
            if (!this.playing) return;
            this.playing = false;
            if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.rafId = null;
            }
        },

        resume: function () {
            var self = this;
            if (this.playing) return;
            this.playing = true;
            this.lastFrameTime = performance.now(); // évite un delta énorme au réveil
            this.rafId = requestAnimationFrame(function (t) { self.tick(t); });
        },

        tick: function (now) {
            var self = this;
            var delta = now - this.lastFrameTime;
            this.lastFrameTime = now;
            this.clock += delta;

            // cues de la timeline
            this.timeline.forEach(function (cue) {
                if (!cue.fired && self.clock >= cue.time) {
                    cue.fired = true;
                    self.fireEvent(cue.target, cue.event);
                }
            });

            // règles périodiques/aléatoires
            this.randomRules.forEach(function (rule) {
                if (rule.events.length === 0) return;
                if (self.clock >= rule.nextFire) {
                    var pick = rule.events[Math.floor(Math.random() * rule.events.length)];
                    self.fireEvent(rule.target, pick);

                    var jitterFactor = 1 + (Math.random() * 2 - 1) * rule.jitter;
                    rule.nextFire = self.clock + Math.max(50, rule.interval * jitterFactor);
                }
            });

            // fin du scénario
            if (this.data.duration > 0 && this.clock >= this.data.duration) {
                if (this.data.loop) {
                    this.start(); // relance un nouveau cycle
                    return;
                } else {
                    this.stop();
                    return;
                }
            }

            this.rafId = requestAnimationFrame(function (t) { self.tick(t); });
        },

        fireEvent: function (targetSelector, eventName) {
            if (!targetSelector || !eventName) return;
            var targets = document.querySelectorAll(targetSelector);
            if (targets.length === 0) {
                console.warn("scheduler : aucune cible trouvée pour '" + targetSelector + "'");
                return;
            }
            targets.forEach(function (el) { el.emit(eventName); });
            console.log("scheduler [" + Math.round(this.clock) + "ms] : event '" + eventName +
                "' envoyé à '" + targetSelector + "'");
        },

        remove: function () {
            if (this.rafId) cancelAnimationFrame(this.rafId);
        }
    });

})();
