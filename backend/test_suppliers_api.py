#!/usr/bin/env python
import os
import django
import json

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.test import Client
from django.contrib.auth import get_user_model

User = get_user_model()

# Create a test client
client = Client()

# Get admin user
admin = User.objects.filter(username='admin').first()
if not admin:
    print("Admin user not found")
    exit(1)

print(f"Testing with admin user: {admin.username}")
print(f"Admin profile: {admin.profile}")
print(f"Admin profile role: {admin.profile.role}")

# Try to access suppliers endpoint
print("\nTesting /api/catalog/suppliers/ endpoint:")
response = client.get('/api/catalog/suppliers/')
print(f"Status: {response.status_code}")
print(f"Response: {response.content[:200]}")

# Try with authentication
print("\nTesting with force_login:")
client.force_login(admin)
response = client.get('/api/catalog/suppliers/')
print(f"Status: {response.status_code}")
if response.status_code == 200:
    data = json.loads(response.content)
    print(f"Response: {json.dumps(data, indent=2)[:200]}")
else:
    print(f"Response: {response.content[:200]}")
