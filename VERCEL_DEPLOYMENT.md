# Vercel Deployment Guide for SreeAndhraValmiki Media Upload API

## Setup Completed ✅

Your project has been configured for Vercel deployment with the following:
- `vercel.json` - Vercel configuration file
- `api/index.js` - Serverless function entry point
- `.vercelignore` - Deployment optimization

## Pre-Deployment Checklist

Before deploying, ensure you have:

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com)
2. **Git Repository**: Your code pushed to GitHub, GitLab, or Bitbucket
3. **Environment Variables**: Prepare these secrets in Vercel dashboard:
   - `MONGODB_URI` - Your MongoDB connection string
   - `JWT_SECRET` - JWT secret key
   - `SMTP_*` - Email configuration (if applicable)
   - Any other API keys or secrets

## Deployment Steps

### Option 1: Deploy via Vercel Dashboard (Easiest)

1. Go to [vercel.com/new](https://vercel.com/new)
2. Select your Git repository
3. Choose project root: `media-upload-api`
4. In **Build & Development Settings**:
   - Build Command: Leave default or use `npm run build`
   - Output Directory: Leave empty
   - Install Command: `npm install`
5. Add environment variables under "Environment Variables"
6. Click **Deploy**

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Navigate to project directory
cd media-upload-api

# Login to Vercel
vercel login

# Deploy
vercel

# For production
vercel --prod
```

## Important Notes for Vercel Deployment

### ⚠️ File Upload Limitations
Vercel's serverless functions have `/tmp` directory for temporary storage (512MB limit). For persistent file storage:
- Use AWS S3 or similar cloud storage
- Or use a separate file server (like Heroku)
- Update `multer` configuration to upload to external service instead

### ⚠️ Environment Variables
Set these in Vercel Dashboard → Settings → Environment Variables:
```
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
NODE_ENV=production
```

### ⚠️ Frontend Build
If serving frontend from the same project, ensure:
```bash
cd frontend
npm run build
```
The frontend dist folder must exist at `frontend/dist` before deployment.

## Environment Variables Template

Create a `.env` file for local development (never commit to Git):
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database
JWT_SECRET=your-secret-key-here
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE=your_phone_number
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SENDGRID_API_KEY=your_sendgrid_key
```

## Post-Deployment

1. Test your API endpoints:
   ```bash
   curl https://your-project.vercel.app/api/health
   ```

2. Monitor logs in Vercel Dashboard
3. Check for any connection issues with MongoDB
4. Verify file uploads are working (if using S3 or similar)

## Troubleshooting

### MongoDB Connection Issues
- Verify MongoDB Atlas IP whitelist includes Vercel's IPs (0.0.0.0/0 for Vercel)
- Check MONGODB_URI format

### File Upload Not Working
- Vercel `/tmp` directory is temporary
- Implement AWS S3 or similar for persistent storage
- Check file size limits match Vercel's constraints

### Environment Variables Not Loading
- Ensure variables are set in Vercel Dashboard
- Redeploy after adding variables
- Check variable names match exactly

## Support

For issues, check:
- Vercel Logs: Dashboard → Deployments → View Deployment → Logs
- MongoDB Atlas connection status
- API endpoint responses with curl or Postman

---
**Deployed on**: [Your Vercel URL]
**Last Updated**: January 20, 2026
