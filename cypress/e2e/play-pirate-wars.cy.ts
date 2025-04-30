describe('homepage spec', () => {
  beforeEach(() => {
    cy.visit('/')
  })

  it('successfully loads the homepage', () => {
    cy.url().should('include', 'localhost:5000')
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
        { id: 'cypress-man-o-war-card', type: 'man o\' war' }
      ]
      const selectedShip = ships[Math.floor(Math.random() * ships.length)]
      cy.log(`Selected ship: ${selectedShip.type}`)

      cy.get(`[data-testid="${selectedShip.id}"]`).click()
      cy.get('[data-testid="cypress-start-game-button"]').click()

      // Wait for game to load and verify player name and ship type in HUD
      cy.wait(5000) // Wait 5 seconds for initial load
      cy.get('[data-testid="cypress-player-name"]').should('have.text', name)
      cy.get('[data-testid="cypress-ship-type"]').should('have.text', selectedShip.type)
    })
  })
})