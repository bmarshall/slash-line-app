
const generatePlayerElement = (player, toClickHandler) => {
    const newDiv = document.createElement("div");
    const newContent = document.createTextNode(player.name);
    newDiv.appendChild(newContent);
    newDiv.addEventListener('click', toClickHandler(player));
    return newDiv;
}

customElements.define('player-list',
  class extends HTMLElement {

    drawList (players, toClickHandler) {
        players.forEach((player) => {
            this.shadowRoot.appendChild(generatePlayerElement(player, toClickHandler));
        })
    }

    constructor() {
      super();

      this.attachShadow({mode: 'open'});
    }
  }
);