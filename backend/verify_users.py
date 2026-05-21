from accounts.models import UserProfile

for up in UserProfile.objects.all():
    print(f'{up.user.username}: PIN={up.pin_enabled}, Role={up.role}')
