AdSphere

AdSphere is an advertisement platform where companies can register and submit advertisements for display as cards. The application uses Supabase for backend services and is designed to support advertisement plans, image uploads, and subscription/payment workflows.
Features
- Company registration and authentication through Supabase.
- Advertisement submission with plan tiers (T1, T2, T3).
- Category support: Eat, Shopping, Play, Stay, and Services.
- Image uploads for plans that support images.
- Advertisement subscriptions and payment-status tracking.
- Supabase-backed data storage and application workflows.
- React frontend suitable for deployment on Vercel.
Feature availability and behavior depend on the current application implementation and Supabase configuration.

Tech Stack
- Frontend: React, JavaScript, Vite (if configured in this project)
- Backend services: Supabase
- Database: Supabase PostgreSQL
- File storage: Supabase Storage
- Deployment: Vercel
- Source control: Git and GitHub
Getting Started
Prerequisites
- Node.js (LTS recommended)
- npm
- A Supabase project
- Git
1. Clone the repository
git clone https://github.com/akbar-dev20/AdSphere.git
cd adsphere-frontend
If your local folder or repository uses a different name, adjust the cd command.
2. Install dependencies
npm install
3. Configure environment variables
Create a .env.local file in the project root. Add the environment variables expected by your Supabase client code. For example, if your code references these names:
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_or_publishable_key
Use the exact variable names referenced in your source code. Vite exposes variables prefixed with VITE_ to browser code, so never put a Supabase service-role key or another private secret in a VITE_ variable.
4. Run the development server
npm run dev
Open the local URL printed by Vite in the terminal (commonly http://localhost:5173).
5. Create a production build
npm run build
To preview the production build locally, if the project defines the preview script:
npm run preview
Supabase Setup
AdSphere uses Supabase for authentication, database operations, and file storage. Configure your Supabase project to match the application.
The current application setup may include these tables:
- company
- advRec
- ad_subscriptions
- ad_plan_prices
Storage buckets used by the application may include:
- ad-images
- payment-proofs
The database schema, Row Level Security (RLS) policies, storage policies, and SQL functions must be configured in Supabase for the relevant application flows to work. Creating the frontend alone does not create these backend resources.
Advertisement plan prices
Plan pricing is stored in the ad_plan_prices table. Keep frontend display and backend validation consistent with the values configured in Supabase.
Authentication redirects
For production deployment, configure the Supabase Auth Site URL and allowed redirect URLs to include your deployed Vercel URL. Keep localhost URLs for local development if needed.
Deploy on Vercel
1. Push the project to GitHub.
2. Sign in to Vercel using the GitHub account that owns or can access the repository.
3. Select Add New → Project and import the AdSphere repository.
4. If this is a Vite app, use these settings when they match your project:
   - Framework Preset: Vite
   - Build Command: npm run build
   - Output Directory: dist
   - Install Command: npm install
   - Root Directory: the directory containing package.json
5. Add the required environment variables in Vercel's project settings.
6. Deploy and test the deployed URL.
Vercel can redeploy the application automatically when new commits are pushed to the connected GitHub branch.
Suggested .gitignore
Make sure local dependencies, build artifacts, and environment files are not committed:
node_modules/
dist/
.env
.env.*
!.env.example
Review git status before committing to ensure credentials and private files are not included.
Common Commands
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Inspect repository status
git status

# Push changes to GitHub
git add .
git commit -m "Describe your changes"
git push
Security Notes
- Never commit .env or .env.local files.
- Never expose Supabase service-role keys or other backend secrets in frontend code.
- Use appropriate Supabase Row Level Security (RLS) and Storage policies.
- Validate sensitive operations on the backend; do not rely only on frontend checks.
- Avoid committing real customer data, payment proofs, or credentials.
Contributing
1. Create a branch for your change.
2. Make and test your changes locally.
3. Run npm run build.
4. Commit and push your changes.
5. Open a pull request.
License
No license has been specified yet. Add a LICENSE file and update this section before distributing the project publicly.
