// Main Application JavaScript
class PromptEngineeringTutorial {
    constructor() {
        this.currentSection = 'tutorial-how-to';
        this.completedSections = new Set();
        this.apiKey = localStorage.getItem('anthropic_api_key') || '';
        this.init();
    }

    init() {
        this.loadProgress();
        this.setupEventListeners();
        this.loadFromHash();
        this.updateProgress();
        this.updateNavigationState();
    }

    setupEventListeners() {
        // Navigation links (sidebar and content links)
        document.addEventListener('click', (e) => {
            if (e.target.matches('.nav-link, .lesson-link')) {
                e.preventDefault();
                const sectionId = e.target.getAttribute('href').substring(1);
                this.navigateToSection(sectionId);
            }
        });

        // Navigation buttons
        document.getElementById('prevBtn').addEventListener('click', () => this.navigatePrevious());
        document.getElementById('nextBtn').addEventListener('click', () => this.navigateNext());

        // API Key modal
        document.getElementById('apiKeyBtn').addEventListener('click', () => this.showApiKeyModal());
        document.getElementById('closeModal').addEventListener('click', () => this.hideApiKeyModal());
        document.getElementById('cancelApiKey').addEventListener('click', () => this.hideApiKeyModal());
        document.getElementById('saveApiKey').addEventListener('click', () => this.saveApiKey());

        // Exercise modal
        document.getElementById('closeExerciseModal').addEventListener('click', () => this.hideExerciseModal());

        // Modal backdrop clicks
        document.getElementById('apiKeyModal').addEventListener('click', (e) => {
            if (e.target.id === 'apiKeyModal') this.hideApiKeyModal();
        });
        document.getElementById('exerciseModal').addEventListener('click', (e) => {
            if (e.target.id === 'exerciseModal') this.hideExerciseModal();
        });

        // Hash change navigation
        window.addEventListener('hashchange', () => {
            this.loadFromHash();
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' && e.ctrlKey) this.navigatePrevious();
            if (e.key === 'ArrowRight' && e.ctrlKey) this.navigateNext();
            if (e.key === 'Escape') {
                this.hideApiKeyModal();
                this.hideExerciseModal();
            }
        });
    }

    navigateToSection(sectionId) {
        if (tutorialContent[sectionId]) {
            this.currentSection = sectionId;
            window.location.hash = sectionId;
            this.loadContent(sectionId);
            this.updateNavigationState();
            this.updateActiveNavLink();
            this.markSectionAsCompleted(sectionId);
            this.saveProgress();
        }
    }

    loadFromHash() {
        const hash = window.location.hash.substring(1);
        if (hash && tutorialContent[hash]) {
            this.currentSection = hash;
        }
        this.loadContent(this.currentSection);
        this.updateActiveNavLink();
    }

    navigatePrevious() {
        const currentIndex = contentOrder.indexOf(this.currentSection);
        if (currentIndex > 0) {
            this.navigateToSection(contentOrder[currentIndex - 1]);
        }
    }

    navigateNext() {
        const currentIndex = contentOrder.indexOf(this.currentSection);
        if (currentIndex < contentOrder.length - 1) {
            this.navigateToSection(contentOrder[currentIndex + 1]);
        }
    }

    loadContent(sectionId) {
        const content = tutorialContent[sectionId];
        if (content) {
            document.getElementById('content-area').innerHTML = content.content;
            document.title = `${content.title} - Anthropic's Prompt Engineering Tutorial`;
            
            // Syntax highlighting for code blocks
            if (window.Prism) {
                Prism.highlightAll();
            }

            // Scroll to top
            document.getElementById('content-area').scrollTop = 0;
        }
    }

    updateNavigationState() {
        const currentIndex = contentOrder.indexOf(this.currentSection);
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');

        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === contentOrder.length - 1;

        if (currentIndex === contentOrder.length - 1) {
            nextBtn.textContent = 'Complete Tutorial';
        } else {
            nextBtn.textContent = 'Next →';
        }
    }

    updateActiveNavLink() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            const href = link.getAttribute('href');
            if (href === `#${this.currentSection}`) {
                link.classList.add('active');
            }
        });
    }

    markSectionAsCompleted(sectionId) {
        this.completedSections.add(sectionId);
        this.updateProgress();
        
        // Add completed class to nav link
        const navLink = document.querySelector(`a[href="#${sectionId}"]`);
        if (navLink) {
            navLink.classList.add('completed');
        }
    }

    updateProgress() {
        const totalSections = contentOrder.length;
        const completedCount = this.completedSections.size;
        const progressText = `Progress: ${completedCount}/${totalSections}`;
        
        document.querySelector('.progress-text').textContent = progressText;
        
        // Update progress bar if it exists
        const progressBar = document.querySelector('.progress-bar');
        if (progressBar) {
            const percentage = (completedCount / totalSections) * 100;
            progressBar.style.width = `${percentage}%`;
        }
    }

    saveProgress() {
        localStorage.setItem('tutorial_progress', JSON.stringify({
            currentSection: this.currentSection,
            completedSections: Array.from(this.completedSections)
        }));
    }

    loadProgress() {
        const saved = localStorage.getItem('tutorial_progress');
        if (saved) {
            const progress = JSON.parse(saved);
            this.currentSection = progress.currentSection || 'tutorial-how-to';
            this.completedSections = new Set(progress.completedSections || []);
        }
    }

    // API Key Management
    showApiKeyModal() {
        document.getElementById('apiKeyModal').classList.add('show');
        document.getElementById('apiKeyInput').value = this.apiKey;
        document.getElementById('apiKeyInput').focus();
    }

    hideApiKeyModal() {
        document.getElementById('apiKeyModal').classList.remove('show');
    }

    saveApiKey() {
        const apiKey = document.getElementById('apiKeyInput').value.trim();
        if (apiKey) {
            this.apiKey = apiKey;
            localStorage.setItem('anthropic_api_key', apiKey);
            this.hideApiKeyModal();
            this.showAlert('API key saved successfully!', 'success');
        } else {
            this.showAlert('Please enter a valid API key', 'error');
        }
    }

    // Exercise Management
    showExerciseModal(exerciseData) {
        document.getElementById('exerciseTitle').textContent = exerciseData.title;
        document.getElementById('exerciseContent').innerHTML = exerciseData.content;
        document.getElementById('exerciseModal').classList.add('show');
    }

    hideExerciseModal() {
        document.getElementById('exerciseModal').classList.remove('show');
    }

    // Claude API Integration
    async callClaudeAPI(prompt, options = {}) {
        if (!this.apiKey) {
            this.showAlert('Please set your API key first', 'warning');
            this.showApiKeyModal();
            return null;
        }

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: options.max_tokens || 1000,
                    temperature: options.temperature || 0,
                    messages: [{
                        role: 'user',
                        content: prompt
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.content[0].text;
        } catch (error) {
            console.error('Claude API Error:', error);
            this.showAlert(`Error calling Claude API: ${error.message}`, 'error');
            return null;
        }
    }

    // Exercise Functions (called from exercise content)
    async runExercise(exerciseId) {
        const promptInput = document.getElementById(exerciseId);
        const responseArea = document.getElementById(`response${exerciseId.slice(-1)}`);
        
        if (!promptInput || !responseArea) return;

        const prompt = promptInput.value.trim();
        if (!prompt) {
            this.showAlert('Please enter a prompt first', 'warning');
            return;
        }

        responseArea.className = 'response-area loading';
        responseArea.innerHTML = '<div class="spinner"></div>Loading Claude\'s response...';

        const response = await this.callClaudeAPI(prompt);
        
        if (response) {
            responseArea.className = 'response-area success';
            responseArea.textContent = response;
            this.markSectionAsCompleted(this.currentSection);
        } else {
            responseArea.className = 'response-area error';
            responseArea.textContent = 'Failed to get response from Claude. Please check your API key and try again.';
        }
    }

    async comparePrompts(exerciseId1, exerciseId2) {
        const prompt1 = document.getElementById(exerciseId1).value.trim();
        const prompt2 = document.getElementById(exerciseId2).value.trim();
        const responseArea = document.getElementById(`response${exerciseId1.slice(-1)}`);

        if (!prompt1 || !prompt2) {
            this.showAlert('Please enter both prompts to compare', 'warning');
            return;
        }

        responseArea.className = 'response-area loading';
        responseArea.innerHTML = '<div class="spinner"></div>Comparing prompts...';

        const [response1, response2] = await Promise.all([
            this.callClaudeAPI(prompt1),
            this.callClaudeAPI(prompt2)
        ]);

        if (response1 && response2) {
            responseArea.className = 'response-area success';
            responseArea.innerHTML = `
                <div style="margin-bottom: 1rem;">
                    <strong>Response to Version A:</strong>
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 0.25rem; margin: 0.5rem 0;">
                        ${response1}
                    </div>
                </div>
                <div>
                    <strong>Response to Version B:</strong>
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 0.25rem; margin: 0.5rem 0;">
                        ${response2}
                    </div>
                </div>
            `;
            this.markSectionAsCompleted(this.currentSection);
        } else {
            responseArea.className = 'response-area error';
            responseArea.textContent = 'Failed to get responses. Please check your API key and try again.';
        }
    }

    async compareRoles(exerciseId1, exerciseId2) {
        const role1 = document.getElementById(exerciseId1).value.trim();
        const role2 = document.getElementById(exerciseId2).value.trim();
        const responseArea = document.getElementById(`response${exerciseId1.slice(-1)}`);

        if (!role1 || !role2) {
            this.showAlert('Please enter both role assignments to compare', 'warning');
            return;
        }

        const baseQuestion = "How should I invest $10,000?";
        const prompt1 = `${role1}\n\n${baseQuestion}`;
        const prompt2 = `${role2}\n\n${baseQuestion}`;

        responseArea.className = 'response-area loading';
        responseArea.innerHTML = '<div class="spinner"></div>Comparing role-based responses...';

        const [response1, response2] = await Promise.all([
            this.callClaudeAPI(prompt1),
            this.callClaudeAPI(prompt2)
        ]);

        if (response1 && response2) {
            responseArea.className = 'response-area success';
            responseArea.innerHTML = `
                <div style="margin-bottom: 1rem;">
                    <strong>Role A Response:</strong>
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 0.25rem; margin: 0.5rem 0;">
                        ${response1}
                    </div>
                </div>
                <div>
                    <strong>Role B Response:</strong>
                    <div style="background: #f8f9fa; padding: 1rem; border-radius: 0.25rem; margin: 0.5rem 0;">
                        ${response2}
                    </div>
                </div>
            `;
            this.markSectionAsCompleted(this.currentSection);
        } else {
            responseArea.className = 'response-area error';
            responseArea.textContent = 'Failed to get responses. Please check your API key and try again.';
        }
    }

    showHint(exerciseId) {
        const hints = exerciseHints[exerciseId];
        if (hints) {
            const hintText = hints.map((hint, index) => `${index + 1}. ${hint}`).join('\n');
            this.showAlert(`Hints for this exercise:\n\n${hintText}`, 'info');
        }
    }

    showAlert(message, type = 'info') {
        // Create alert element
        const alert = document.createElement('div');
        alert.className = `alert alert-${type}`;
        alert.style.position = 'fixed';
        alert.style.top = '20px';
        alert.style.right = '20px';
        alert.style.zIndex = '1001';
        alert.style.minWidth = '300px';
        alert.style.whiteSpace = 'pre-line';
        alert.textContent = message;

        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.float = 'right';
        closeBtn.style.background = 'none';
        closeBtn.style.border = 'none';
        closeBtn.style.fontSize = '1.2rem';
        closeBtn.style.cursor = 'pointer';
        closeBtn.style.marginLeft = '10px';
        closeBtn.onclick = () => alert.remove();

        alert.appendChild(closeBtn);
        document.body.appendChild(alert);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }
}

// Global functions for exercise buttons (called from HTML content)
let app;

function runExercise(exerciseId) {
    app.runExercise(exerciseId);
}

function comparePrompts(exerciseId1, exerciseId2) {
    app.comparePrompts(exerciseId1, exerciseId2);
}

function compareRoles(exerciseId1, exerciseId2) {
    app.compareRoles(exerciseId1, exerciseId2);
}

function showHint(exerciseId) {
    app.showHint(exerciseId);
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    app = new PromptEngineeringTutorial();
}); 
