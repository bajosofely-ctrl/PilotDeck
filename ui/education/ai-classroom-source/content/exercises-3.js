export const exercises3 = {
    id: 'exercises-3',
    title: 'Exercises 3: Assigning Roles (Role Prompting)',
    content: `
        <h1>Exercises 3: Assigning Roles (Role Prompting)</h1>
        
        <p>Discover the power of role prompting through these practical exercises. See how different roles can dramatically change Claude's responses.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 3.1: Choose the Right Role</h2>
            
            <p><strong>Scenario:</strong> You need advice on investing $10,000 for retirement planning.</p>
            <p><strong>Your task:</strong> Create a prompt with an appropriate role assignment.</p>
            
            <div class="exercise-input">
                <label for="exercise-3-1">Your role-based prompt:</label>
                <textarea id="exercise-3-1" rows="6" placeholder="Assign a role and ask for investment advice..."></textarea>
                <button onclick="runExercise('3-1')" class="btn btn-primary">Test Your Prompt</button>
            </div>
            
            <div id="result-3-1" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Consider what type of professional would be best qualified to give retirement investment advice. Think about their expertise, experience level, and approach.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 3.2: Role Comparison</h2>
            
            <p>See how different roles affect the same question. Try both prompts and compare the responses:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Role A: Teacher</h4>
                    <div class="code-block">
                        <pre>You are an elementary school teacher explaining to 8-year-olds.

How does photosynthesis work?</pre>
                    </div>
                    <button onclick="compareRoles('teacher', 'You are an elementary school teacher explaining to 8-year-olds. How does photosynthesis work?')" class="btn btn-secondary">Try Teacher Role</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Role B: Scientist</h4>
                    <div class="code-block">
                        <pre>You are a botany researcher with a PhD in plant biology.

How does photosynthesis work?</pre>
                    </div>
                    <button onclick="compareRoles('scientist', 'You are a botany researcher with a PhD in plant biology. How does photosynthesis work?')" class="btn btn-secondary">Try Scientist Role</button>
                </div>
            </div>
            
            <div id="role-comparison-results" class="comparison-results"></div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 3.3: Enhanced Role Prompting</h2>
            
            <p><strong>Challenge:</strong> Create an enhanced role prompt with detailed background and context.</p>
            <p><strong>Scenario:</strong> You need a marketing strategy for a new eco-friendly product line.</p>
            
            <div class="exercise-input">
                <label for="exercise-3-3">Your enhanced role prompt:</label>
                <textarea id="exercise-3-3" rows="8" placeholder="Create a detailed role with background, expertise, and approach..."></textarea>
                <button onclick="runExercise('3-3')" class="btn btn-primary">Test Your Enhanced Prompt</button>
            </div>
            
            <div id="result-3-3" class="exercise-result"></div>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Enhanced Role</summary>
                    <div class="code-block">
                        <pre>You are a senior marketing strategist with 12 years of experience in sustainable consumer goods. Your expertise includes green marketing, millennial/Gen-Z consumer behavior, and brand positioning for eco-conscious products. Your approach combines data-driven insights with authentic storytelling that resonates with environmentally aware consumers.

Create a comprehensive marketing strategy for launching a new line of biodegradable household cleaning products targeting urban millennials aged 25-40. Include target audience analysis, key messaging, channel recommendations, and a 6-month launch timeline.</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 3.4: Multiple Perspective Analysis</h2>
            
            <p>Use role prompting to get multiple viewpoints on the same topic:</p>
            
            <div class="exercise-input">
                <label for="exercise-3-4">Your multi-perspective prompt:</label>
                <textarea id="exercise-3-4" rows="6" placeholder="Ask for analysis from multiple role perspectives..."></textarea>
                <button onclick="runExercise('3-4')" class="btn btn-primary">Test Multi-Perspective Prompt</button>
            </div>
            
            <div id="result-3-4" class="exercise-result"></div>
            
            <p><strong>Suggested topic:</strong> "Remote work policies in companies" - analyze from the perspectives of:</p>
            <ul>
                <li>An HR manager</li>
                <li>A software developer</li>
                <li>A company CEO</li>
            </ul>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 3.5: Creative Role Application</h2>
            
            <p>Get creative with role assignments! Try an unconventional but relevant role:</p>
            
            <div class="exercise-input">
                <label for="exercise-3-5">Your creative role prompt:</label>
                <textarea id="exercise-3-5" rows="6" placeholder="Try a creative or unexpected role assignment..."></textarea>
                <button onclick="runExercise('3-5')" class="btn btn-primary">Test Creative Role</button>
            </div>
            
            <div id="result-3-5" class="exercise-result"></div>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Creative Role Ideas</summary>
                    <ul>
                        <li>"You are a time traveler from 2050 explaining current technology trends..."</li>
                        <li>"You are a detective investigating this business problem..."</li>
                        <li>"You are a friendly alien anthropologist studying human behavior..."</li>
                        <li>"You are a wise mentor from ancient times giving modern advice..."</li>
                    </ul>
                </details>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Key Insights from Role Prompting:</strong></p>
            <ul>
                <li>Roles shape both content and communication style</li>
                <li>Specific roles with detailed backgrounds yield more targeted responses</li>
                <li>Different roles can reveal different aspects of the same topic</li>
                <li>Creative roles can provide fresh perspectives and engaging content</li>
                <li>Matching the role to your audience and goals improves relevance</li>
            </ul>
        </div>
    `
};

export const exerciseHints3 = {
    '3-1': {
        hint: "Think about financial professionals who specialize in retirement planning. Consider their qualifications, experience, and approach to helping clients.",
        solution: `You are a certified financial planner (CFP) with 15 years of experience specializing in retirement planning for middle-income professionals. Your approach focuses on diversified, long-term growth strategies with appropriate risk management.

I have $10,000 to invest for retirement and I'm 35 years old. What investment strategy would you recommend, considering my age, risk tolerance, and retirement timeline? Please provide specific allocation suggestions and explain your reasoning.`
    },
    '3-3': {
        hint: "Include specific years of experience, industry expertise, target demographics knowledge, and methodology. Make the role detailed enough to guide the response style and content.",
        solution: `You are a senior marketing strategist with 12 years of experience in sustainable consumer goods. Your expertise includes green marketing, millennial/Gen-Z consumer behavior, and brand positioning for eco-conscious products. Your approach combines data-driven insights with authentic storytelling that resonates with environmentally aware consumers.

Create a comprehensive marketing strategy for launching a new line of biodegradable household cleaning products targeting urban millennials aged 25-40. Include target audience analysis, key messaging, channel recommendations, and a 6-month launch timeline.`
    },
    '3-4': {
        hint: "Structure your prompt to clearly request analysis from each specified perspective. You can ask for separate sections or a comparative analysis.",
        solution: `Analyze remote work policies from three different perspectives:

1. As an HR manager responsible for employee engagement and company culture
2. As a software developer who values work-life balance and productivity  
3. As a company CEO focused on business outcomes and operational efficiency

For each perspective, explain the main benefits, concerns, and ideal policy recommendations. Highlight where these viewpoints align or conflict.`
    },
    '3-5': {
        hint: "Choose a creative role that still brings relevant expertise or perspective to your topic. The role should be imaginative but purposeful.",
        solution: `You are a time traveler from the year 2050 who has seen how current technology trends played out over the next 30 years.

Looking back from 2050, explain which technology trends from 2024 (AI, renewable energy, space exploration, biotech) had the biggest impact on society, and what surprised you most about how they developed. Share insights that people in 2024 should know about preparing for the future.`
    }
}; 
