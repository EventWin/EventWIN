from rest_framework.routers import DefaultRouter

from .views import BudgetCategoryViewSet, BudgetViewSet, CostItemViewSet


router = DefaultRouter()
router.register(r'budgets', BudgetViewSet, basename='budget')
router.register(r'budget-categories', BudgetCategoryViewSet, basename='budget-category')
router.register(r'cost-items', CostItemViewSet, basename='cost-item')

urlpatterns = router.urls