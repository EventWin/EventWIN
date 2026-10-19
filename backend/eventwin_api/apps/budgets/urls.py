from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import BudgetCategoryCompatView, BudgetCompatView, BudgetItemViewSet


router = DefaultRouter()
router.register(r'budget-items', BudgetItemViewSet, basename='budget-item')

urlpatterns = [
    # Agrégats read-only consommés par le jumeau numérique (/app/home).
    path('budgets/', BudgetCompatView.as_view(), name='budget-compat'),
    path('budget-categories/', BudgetCategoryCompatView.as_view(), name='budget-category-compat'),
    *router.urls,
]
