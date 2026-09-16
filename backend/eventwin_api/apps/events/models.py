from django.db import models


class Event(models.Model):
    title = models.CharField(max_length=255)
    status = models.CharField(max_length=50, default='draft')
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title
