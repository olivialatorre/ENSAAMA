
shader:flat dans le materiel de l'objet
dans la balise scene : <a-scene fog="type: exponential; color: white; density: 0.5">
pour afficher du text : <a-text value="ERROR 404\nFILE NOT FOUND" color="#0f0" align="center" width="1.2" position="0 0 0.01"></a-text>
pour cibler des elements qui ont une caracteristique dans un entity:
document.querySelectorAll('#bureau *').forEach((el) => {
  if (el.hasAttribute('material')) {
    el.setAttribute('material', 'emissiveIntensity', 0);
  }
});
attacher un plane à la camera: <a-entity camera look-controls>
                                <a-entity geometry="primitive: plane; height: 0.2; width: 0.2" position="0 0 -1"
                                    material="color: gray; opacity: 0.5"></a-entity>
                                </a-entity>