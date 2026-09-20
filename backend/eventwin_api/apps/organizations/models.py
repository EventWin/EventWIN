from django.db import models

from apps.base_models import UUIDTimestampedModel


class Organization(UUIDTimestampedModel):
    name = models.CharField(max_length=255)
    legal_name = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return self.name
