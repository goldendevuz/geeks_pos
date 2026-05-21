#!/usr/bin/env python
import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from accounts.models import UserProfile, Role

User = get_user_model()

# Check admin user
admin = User.objects.filter(username='admin').first()
if admin:
    print(f"Admin user found: {admin.username}")
    print(f"Is superuser: {admin.is_superuser}")
    print(f"Is staff: {admin.is_staff}")
    
    profile = UserProfile.objects.filter(user=admin).first()
    if profile:
        print(f"Profile role: {profile.role}")
    else:
        print("No profile found")
else:
    print("Admin user not found")

# List all users
print("\nAll users:")
for user in User.objects.all():
    profile = UserProfile.objects.filter(user=user).first()
    role = profile.role if profile else "NO PROFILE"
    print(f"  {user.username}: superuser={user.is_superuser}, role={role}")
