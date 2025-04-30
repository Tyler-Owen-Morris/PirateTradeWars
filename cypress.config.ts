import { defineConfig } from 'cypress'

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:5000',
    setupNodeEvents(on, config) {
      // Optional: Add custom event listeners or tasks here
    },
    specPattern: 'cypress/e2e/**/*.cy.{js,ts}', // Pattern for test files
  }
})