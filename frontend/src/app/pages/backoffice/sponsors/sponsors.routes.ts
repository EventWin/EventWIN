import { Routes } from '@angular/router';

export const SPONSORS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./sponsors.component').then(m => m.SponsorsComponent),
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', loadComponent: () => import('./sponsor-overview.component').then(m => m.SponsorOverviewComponent) },
      { path: 'pipeline', loadComponent: () => import('./sponsor-pipeline.component').then(m => m.SponsorPipelineComponent) },
      { path: 'directory', loadComponent: () => import('./sponsor-directory.component').then(m => m.SponsorDirectoryComponent) },
      { path: 'packages', loadComponent: () => import('./sponsor-packages.component').then(m => m.SponsorPackagesComponent) },
      { path: 'deliverables', loadComponent: () => import('./sponsor-deliverables.component').then(m => m.SponsorDeliverablesComponent) },
      { path: 'payments', loadComponent: () => import('./sponsor-payments.component').then(m => m.SponsorPaymentsComponent) },
      { path: 'analysis', loadComponent: () => import('./sponsor-fit.component').then(m => m.SponsorFitComponent) }
    ]
  }
];
