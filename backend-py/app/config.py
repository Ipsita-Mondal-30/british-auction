import os

from dotenv import load_dotenv

# No .env in production; env comes from the host. Real env vars win over the file.
load_dotenv(override=False)

DATABASE_URL = os.getenv('DATABASE_URL', '')
FRONTEND_ORIGINS = [o.strip() for o in os.getenv('FRONTEND_ORIGIN', 'http://localhost:3000').split(',') if o.strip()]
PORT = int(os.getenv('PORT', '4001'))
