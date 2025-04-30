describe('homepage spec', () => {
  beforeEach(() => {
    cy.visit('/')
  })

  it('successfully loads the homepage', () => {
    cy.url().should('include', process.env.NGROK_URL || 'http://localhost:5000')
  })

  it('starts game with random ship', () => {
    cy.get('[data-testid="cypress-generate-random-name-button"]').click()
    cy.get('#playerName').invoke('val').should('not.be.empty')
    cy.get('#playerName').invoke('val').then((name) => {
      cy.log(`Generated pirate name: ${name}`)

      // Randomly select a ship
      const ships = [
        { id: 'cypress-sloop-card', type: 'sloop' },
        { id: 'cypress-brigantine-card', type: 'brigantine' },
        { id: 'cypress-galleon-card', type: 'galleon' },
        { id: 'cypress-man-o-war-card', type: 'man-o-war' }
      ]
      const selectedShip = ships[Math.floor(Math.random() * ships.length)]
      cy.log(`Selected ship: ${selectedShip.type}`)

      cy.get(`[data-testid="${selectedShip.id}"]`).click()
      cy.get('[data-testid="cypress-start-game-button"]').click()

      // Wait for game to load and verify player name and ship type in HUD
      cy.wait(5000) // Wait 5 seconds for initial load
      cy.get('[data-testid="cypress-player-name"]').should('have.text', name)
      cy.get('[data-testid="cypress-ship-type"]').should('have.text', selectedShip.type)

      // After verifying HUD, start random actions
      function performRandomActions(actions, remaining) {
        if (remaining <= 0) return;
        const actionObj = actions[Math.floor(Math.random() * actions.length)];
        cy.log(`Performing action: ${actionObj.name}`);
        actionObj.action().then(() => {
          if (actionObj.key) {
            cy.wait(3000); // Hold for 3 seconds
            cy.get('body').trigger('keyup', { key: actionObj.key, code: `Key${actionObj.key.toUpperCase()}`, which: actionObj.key.charCodeAt(0), force: true });
          }
        }).then(() => {
          cy.wait(1000).then(() => performRandomActions(actions, remaining - 4000));
        });
      }

      const actions = [
        {
          key: 'w',
          name: 'move up',
          action: () => cy.get('body').trigger('keydown', { key: 'w', code: 'KeyW', which: 87, force: true })
        },
        {
          key: 's',
          name: 'move down',
          action: () => cy.get('body').trigger('keydown', { key: 's', code: 'KeyS', which: 83, force: true })
        },
        {
          key: 'a',
          name: 'move left',
          action: () => cy.get('body').trigger('keydown', { key: 'a', code: 'KeyA', which: 65, force: true })
        },
        {
          key: 'd',
          name: 'move right',
          action: () => cy.get('body').trigger('keydown', { key: 'd', code: 'KeyD', which: 68, force: true })
        },
        {
          key: null,
          name: 'fire cannon',
          action: () => cy.get('[data-testid=\"cypress-fire-cannon-button\"]', { timeout: 2000 })
            .then($el => $el.length && $el.click())
        }
      ];
      performRandomActions(actions, 60000); // 30 seconds
    })
  })
})