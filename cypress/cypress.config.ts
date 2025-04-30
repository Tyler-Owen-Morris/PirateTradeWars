import { defineConfig } from 'cypress'

export default defineConfig({
    e2e: {
        baseUrl: 'http://localhost:5000',
        setupNodeEvents(on, config) {
            // Optional: Add custom event listeners or tasks here
        },
        supportFile: 'cypress/support/e2e.js', // Default support file
        specPattern: 'cypress/e2e/**/*.cy.{js,ts}', // Pattern for test files
    }
})