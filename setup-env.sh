#!/bin/bash
# Environment Setup Script for PuidBoard
# Run this after creating Upstash Redis and Supabase projects

set -e

echo "🚀 PuidBoard Environment Setup"
echo "================================"
echo ""

# Check if we're in the right directory
if [ ! -f "pnpm-workspace.yaml" ]; then
    echo "❌ Error: Run this script from the project root"
    exit 1
fi

# Function to prompt for input
prompt_input() {
    local var_name=$1
    local prompt_text=$2
    local is_secret=$3

    echo -n "$prompt_text: "
    if [ "$is_secret" = "true" ]; then
        read -s value
        echo ""
    else
        read value
    fi

    eval "$var_name='$value'"
}

echo "📝 Please provide the following credentials:"
echo ""

# Upstash Redis
echo "--- Upstash Redis (from https://console.upstash.com) ---"
prompt_input REDIS_URL "Redis URL (redis://...)" false

# Supabase (optional for now)
echo ""
echo "--- Supabase (from https://supabase.com/dashboard) [OPTIONAL] ---"
prompt_input SUPABASE_URL "Supabase Project URL" false
prompt_input SUPABASE_ANON_KEY "Supabase Anon Key" false
prompt_input SUPABASE_SERVICE_KEY "Supabase Service Role Key" true
prompt_input DATABASE_URL "Database Connection String" true

# Vercel Frontend URL
echo ""
echo "--- Frontend URL (after Vercel deployment) ---"
prompt_input FRONTEND_URL "Vercel frontend URL (https://...)" false

echo ""
echo "🔧 Configuring Fly.io secrets..."
flyctl secrets set \
    REDIS_URL="$REDIS_URL" \
    CORS_ORIGINS="$FRONTEND_URL,http://localhost:3000" \
    --app puidboard-realtime

if [ -n "$DATABASE_URL" ]; then
    flyctl secrets set DATABASE_URL="$DATABASE_URL" --app puidboard-realtime
fi

echo ""
echo "✅ Backend environment configured!"
echo ""
echo "Next steps:"
echo "1. Deploy frontend to Vercel with these env vars:"
echo "   NEXT_PUBLIC_REALTIME_URL=https://puidboard-realtime.fly.dev"
if [ -n "$SUPABASE_URL" ]; then
    echo "   NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL"
    echo "   NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY"
fi
echo ""
echo "2. Test the deployment!"
echo ""
