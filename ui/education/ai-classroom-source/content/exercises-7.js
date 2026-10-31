export const exercises7 = {
    id: 'exercises-7',
    title: 'Exercises 7: Using Examples (Few-Shot Prompting)',
    content: `
        <h1>Exercises 7: Using Examples (Few-Shot Prompting)</h1>
        
        <p>Master the art of few-shot prompting by creating effective examples that guide Claude to produce exactly what you want.</p>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.1: Basic Few-Shot Pattern</h2>
            
            <p><strong>Task:</strong> Create a few-shot prompt for converting casual text into professional business language.</p>
            
            <div class="exercise-input">
                <label for="exercise-7-1">Your few-shot prompt with examples:</label>
                <textarea id="exercise-7-1" rows="10" placeholder="Create 2-3 examples showing casual → professional conversion..."></textarea>
                <button onclick="runExercise('7-1')" class="btn btn-primary">Test Few-Shot Pattern</button>
            </div>
            
            <div id="result-7-1" class="exercise-result"></div>
            
            <p><strong>Test case:</strong> "Hey, can you send me that report ASAP? I need it for my meeting tomorrow."</p>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Hint</summary>
                    <p>Show examples with different types of casual language: slang, informal requests, abbreviated words. Demonstrate consistent professional tone and structure.</p>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.2: Data Extraction Examples</h2>
            
            <p><strong>Challenge:</strong> Create a few-shot prompt for extracting key information from restaurant reviews.</p>
            
            <div class="exercise-input">
                <label for="exercise-7-2">Your data extraction prompt:</label>
                <textarea id="exercise-7-2" rows="12" placeholder="Create examples showing review → structured data extraction..."></textarea>
                <button onclick="runExercise('7-2')" class="btn btn-primary">Test Data Extraction</button>
            </div>
            
            <div id="result-7-2" class="exercise-result"></div>
            
            <p><strong>Test review:</strong> "Amazing Italian place! The pasta was perfect and service was quick. A bit pricey at $25 per dish but worth it. Very crowded on weekends."</p>
            
            <div class="solution-box">
                <details>
                    <summary>✅ Sample Structure</summary>
                    <div class="code-block">
                        <pre>Extract key information from restaurant reviews:

Example 1:
Review: "Great sushi spot! Fresh fish, friendly staff. $15-20 per roll. Gets busy during lunch."
Extracted Info: {
  "cuisine": "Sushi/Japanese",
  "food_quality": "Great - fresh fish",
  "service": "Friendly staff", 
  "price_range": "$15-20 per roll",
  "crowd_level": "Busy during lunch",
  "overall_sentiment": "Positive"
}</pre>
                    </div>
                </details>
            </div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.3: Creative Writing Style</h2>
            
            <p><strong>Scenario:</strong> Create examples for writing engaging social media posts for different types of businesses.</p>
            
            <div class="exercise-input">
                <label for="exercise-7-3">Your creative style examples:</label>
                <textarea id="exercise-7-3" rows="12" placeholder="Show examples of business → social media post conversion..."></textarea>
                <button onclick="runExercise('7-3')" class="btn btn-primary">Test Creative Style</button>
            </div>
            
            <div id="result-7-3" class="exercise-result"></div>
            
            <p><strong>Test business:</strong> Local bookstore hosting a poetry reading event next Friday at 7 PM</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.4: Chain-of-Thought Examples</h2>
            
            <p><strong>Advanced Challenge:</strong> Create few-shot examples that show reasoning process for business decisions.</p>
            
            <div class="exercise-input">
                <label for="exercise-7-4">Your chain-of-thought prompt:</label>
                <textarea id="exercise-7-4" rows="12" placeholder="Show examples with step-by-step reasoning..."></textarea>
                <button onclick="runExercise('7-4')" class="btn btn-primary">Test Reasoning Examples</button>
            </div>
            
            <div id="result-7-4" class="exercise-result"></div>
            
            <p><strong>Test scenario:</strong> A coffee shop owner deciding whether to extend hours until 10 PM</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.5: Classification with Multiple Categories</h2>
            
            <p><strong>Task:</strong> Create examples for classifying customer support tickets into categories.</p>
            
            <div class="exercise-input">
                <label for="exercise-7-5">Your classification prompt:</label>
                <textarea id="exercise-7-5" rows="12" placeholder="Create examples covering different ticket types..."></textarea>
                <button onclick="runExercise('7-5')" class="btn btn-primary">Test Classification</button>
            </div>
            
            <div id="result-7-5" class="exercise-result"></div>
            
            <p><strong>Categories:</strong> Technical Issue, Billing Question, Feature Request, Complaint, Compliment</p>
            <p><strong>Test ticket:</strong> "I love the new dashboard design! However, I can't figure out how to export my data to CSV. Can you help?"</p>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.6: Zero-Shot vs Few-Shot Comparison</h2>
            
            <p>Compare the effectiveness of zero-shot vs few-shot prompting for the same task:</p>
            
            <div class="comparison-exercise">
                <div class="prompt-option">
                    <h4>Zero-Shot Approach</h4>
                    <div class="code-block">
                        <pre>Write compelling product descriptions that highlight benefits and create urgency.</pre>
                    </div>
                    <button onclick="comparePrompts('A-7', 'Write compelling product descriptions that highlight benefits and create urgency.\n\nProduct: Wireless noise-canceling headphones')" class="btn btn-secondary">Try Zero-Shot</button>
                </div>
                
                <div class="prompt-option">
                    <h4>Few-Shot Approach</h4>
                    <div class="code-block">
                        <pre>Write compelling product descriptions following these examples:

Example 1:
Product: Smart Watch
Description: "Don't let another workout go untracked. This smart watch monitors your heart rate, counts your steps, and keeps you motivated with personalized fitness goals. Limited stock - only 50 left!"

Example 2:  
Product: Coffee Maker
Description: "Wake up to café-quality coffee every morning. This programmable coffee maker brews the perfect cup while you sleep, so you never have to wait for your caffeine fix. Order today and transform your mornings forever!"</pre>
                    </div>
                    <button onclick="comparePrompts('B-7', 'Write compelling product descriptions following these examples:\n\nExample 1:\nProduct: Smart Watch\nDescription: \"Don\\'t let another workout go untracked. This smart watch monitors your heart rate, counts your steps, and keeps you motivated with personalized fitness goals. Limited stock - only 50 left!\"\n\nExample 2:\nProduct: Coffee Maker\nDescription: \"Wake up to café-quality coffee every morning. This programmable coffee maker brews the perfect cup while you sleep, so you never have to wait for your caffeine fix. Order today and transform your mornings forever!\"\n\nNow write a description for:\nProduct: Wireless noise-canceling headphones')" class="btn btn-secondary">Try Few-Shot</button>
                </div>
            </div>
            
            <div id="comparison-results-7" class="comparison-results"></div>
        </div>

        <div class="exercise-container">
            <h2>🎯 Exercise 7.7: Edge Case Handling</h2>
            
            <p><strong>Advanced Practice:</strong> Create examples that show how to handle edge cases and unusual inputs.</p>
            
            <div class="exercise-input">
                <label for="exercise-7-7">Your edge case examples:</label>
                <textarea id="exercise-7-7" rows="12" placeholder="Show examples handling incomplete, ambiguous, or unusual inputs..."></textarea>
                <button onclick="runExercise('7-7')" class="btn btn-primary">Test Edge Cases</button>
            </div>
            
            <div id="result-7-7" class="exercise-result"></div>
            
            <p><strong>Task:</strong> Email sentiment analysis that handles incomplete emails, mixed emotions, and sarcasm</p>
            
            <div class="hint-box">
                <details>
                    <summary>💡 Edge Case Types</summary>
                    <ul>
                        <li>Incomplete information</li>
                        <li>Ambiguous meaning</li>
                        <li>Mixed sentiments</li>
                        <li>Sarcasm or irony</li>
                        <li>Very short or very long inputs</li>
                    </ul>
                </details>
            </div>
        </div>

        <div class="alert alert-success">
            <p><strong>Few-Shot Prompting Mastery:</strong></p>
            <ul>
                <li>Examples are more powerful than lengthy instructions</li>
                <li>2-5 diverse examples usually provide the best results</li>
                <li>Consistency in format and style across examples is crucial</li>
                <li>Edge cases in examples help handle unusual inputs</li>
                <li>Chain-of-thought examples improve reasoning quality</li>
                <li>Few-shot dramatically outperforms zero-shot for complex tasks</li>
            </ul>
        </div>
    `
};

export const exerciseHints7 = {
    '7-1': {
        hint: "Create examples showing different casual language patterns (slang, abbreviations, informal tone) and their professional equivalents. Keep the core message the same while changing tone.",
        solution: `Convert casual language to professional business communication:

Example 1:
Casual: "Hey, can you shoot me that file when you get a chance? Thanks!"
Professional: "Good morning, could you please send me the file at your earliest convenience? Thank you for your assistance."

Example 2:
Casual: "The meeting was kinda boring and went way too long. Nothing new was discussed."
Professional: "The meeting covered previously discussed topics and extended beyond the scheduled time. No new information was presented."

Example 3:
Casual: "This project is a total mess. We need to fix it ASAP or we're screwed."
Professional: "This project requires immediate attention and restructuring to meet our objectives and deadlines."

Now convert this:
Casual: "Hey, can you send me that report ASAP? I need it for my meeting tomorrow."`
    },
    '7-2': {
        hint: "Create examples with different types of reviews (positive, negative, mixed) and show consistent data extraction format. Include price, quality, service, atmosphere, and sentiment.",
        solution: `Extract key information from restaurant reviews:

Example 1:
Review: "Great sushi spot! Fresh fish, friendly staff. $15-20 per roll. Gets busy during lunch."
Extracted Info: {
  "cuisine": "Sushi/Japanese",
  "food_quality": "Great - fresh fish",
  "service": "Friendly staff",
  "price_range": "$15-20 per roll", 
  "crowd_level": "Busy during lunch",
  "overall_sentiment": "Positive"
}

Example 2:
Review: "Disappointing pizza place. Soggy crust, rude waiters. Overpriced at $18 for a mediocre pizza."
Extracted Info: {
  "cuisine": "Pizza/Italian",
  "food_quality": "Poor - soggy crust",
  "service": "Poor - rude waiters",
  "price_range": "$18 per pizza",
  "crowd_level": "Not mentioned",
  "overall_sentiment": "Negative"
}

Now extract from:
Review: "Amazing Italian place! The pasta was perfect and service was quick. A bit pricey at $25 per dish but worth it. Very crowded on weekends."`
    },
    '7-3': {
        hint: "Show examples for different business types with engaging, social media-appropriate language. Include emojis, hashtags, and call-to-action elements.",
        solution: `Create engaging social media posts for businesses:

Example 1:
Business: Yoga studio offering morning classes
Post: "Start your day with intention ✨ Join us for sunrise yoga at 6 AM and feel the difference all day long! Your mind and body will thank you 🧘‍♀️ #MorningYoga #Mindfulness #WellnessJourney"

Example 2:
Business: Pizza restaurant launching new menu
Post: "🍕 NEW MENU ALERT! 🍕 We've been cooking up something special... Introducing our artisan wood-fired pizzas with locally sourced ingredients! First 50 customers get 20% off. Who's ready to taste the difference? #NewMenu #LocallySourced #PizzaLovers"

Example 3:
Business: Tech repair shop offering quick service
Post: "Cracked screen? We've got you covered! 📱 Same-day repairs, lifetime warranty, and prices that won't break the bank. Because life's too short for a broken phone! Book online or walk in today 💪 #PhoneRepair #SameDayService #TechSupport"

Now create a post for:
Business: Local bookstore hosting a poetry reading event next Friday at 7 PM`
    },
    '7-4': {
        hint: "Show examples with clear reasoning steps: identify key factors, analyze pros/cons, consider data/evidence, and reach a logical conclusion.",
        solution: `Analyze business decisions with step-by-step reasoning:

Example 1:
Decision: "Should a restaurant add delivery service?"
Analysis:
Step 1: Market demand - Many customers request delivery, competitors offer it
Step 2: Costs - Delivery platform fees (20-30%), need delivery staff or third-party
Step 3: Revenue potential - Could increase sales by 25-40% based on industry data
Step 4: Operational impact - Kitchen may need to handle higher volume, packaging costs
Step 5: Competition - Not offering delivery means losing customers to competitors
Conclusion: Yes, implement delivery. Revenue increase likely outweighs costs and keeps business competitive.

Example 2:
Decision: "Should a boutique expand to a second location?"
Analysis:
Step 1: Current performance - First location profitable for 2+ years, strong customer base
Step 2: Market research - Identified underserved area with target demographic
Step 3: Financial capacity - Have sufficient capital for 6-month runway
Step 4: Management bandwidth - Owner can oversee both locations initially
Step 5: Risk assessment - Second location reduces dependency on single location
Conclusion: Yes, expand. Strong foundation and identified opportunity justify expansion risk.

Now analyze:
Decision: "A coffee shop owner deciding whether to extend hours until 10 PM"`
    },
    '7-5': {
        hint: "Create examples covering all five categories with clear indicators for each type. Show mixed cases where tickets might have multiple elements.",
        solution: `Classify customer support tickets into categories:

Example 1:
Ticket: "The app keeps crashing when I try to upload photos. I've tried restarting my phone but it still doesn't work."
Category: Technical Issue
Priority: High

Example 2:  
Ticket: "I was charged twice for my subscription this month. Can you please refund the duplicate charge?"
Category: Billing Question
Priority: High

Example 3:
Ticket: "Would it be possible to add a dark mode feature? It would be much easier on the eyes for night use."
Category: Feature Request  
Priority: Low

Example 4:
Ticket: "Your customer service representative was extremely helpful today. Sarah went above and beyond to solve my problem!"
Category: Compliment
Priority: Low

Now classify:
Ticket: "I love the new dashboard design! However, I can't figure out how to export my data to CSV. Can you help?"`
    },
    '7-7': {
        hint: "Create examples showing how to handle incomplete emails, mixed emotions, sarcasm, and ambiguous content. Show consistent analysis format even with challenging inputs.",
        solution: `Analyze email sentiment handling edge cases:

Example 1:
Email: "Thanks for the 'help'... really appreciate waiting 3 days for a response."
Analysis: {
  "sentiment": "Negative",
  "confidence": "High", 
  "indicators": "Sarcasm in quotes around 'help', complaint about response time",
  "emotion": "Frustration/Sarcasm"
}

Example 2:
Email: "The product is okay I guess. Works fine but"
Analysis: {
  "sentiment": "Neutral/Negative",
  "confidence": "Low",
  "indicators": "Incomplete message, lukewarm language 'okay I guess'",
  "emotion": "Indifference/Uncertainty"
}

Example 3:
Email: "Love the new features but hate the new interface. Great functionality, terrible design."
Analysis: {
  "sentiment": "Mixed",
  "confidence": "High",
  "indicators": "Clear positive (love features) and negative (hate interface) elements",
  "emotion": "Conflicted satisfaction"
}

Now analyze:
Email: "Well this is just fantastic. Another update that breaks everything. But hey, at least the loading screen looks pretty now."`
    }
}; 
