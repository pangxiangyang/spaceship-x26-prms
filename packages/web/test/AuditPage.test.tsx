import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../src/api/types';
import { AuthProvider } from '../src/auth/AuthContext';
import { AuditPage } from '../src/pages/admin/AuditPage';
import { fakeApi } from './support/fakeApi';

const event = (id: string, action: string): AuditEvent => ({
  id,
  occurredAt: '2026-03-01T09:00:00Z',
  actor: { userId: 'p1', role: 'PASSENGER', displayName: 'Gwen Alvarez' },
  action,
  outcome: 'SUCCESS',
  subject: { type: 'RESOURCE', id: 'r1' },
  details: {},
});

describe('AuditPage', () => {
  it('pages to older events with the cursor the server returned, and back', async () => {
    const requested: (string | null)[] = [];
    const audit = (url: URL) => {
      const cursor = url.searchParams.get('cursor');
      requested.push(cursor);
      return cursor === 'older-1'
        ? { total: 60, nextCursor: null, events: [event('e2', 'USAGE_START')] }
        : { total: 60, nextCursor: 'older-1', events: [event('e1', 'BOOKING_CREATE')] };
    };
    render(
      <AuthProvider client={fakeApi({ '/api/admin/audit': audit })}>
        <AuditPage />
      </AuthProvider>,
    );

    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Booking create' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Older →' }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Usage start' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Older →' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '← Newer' }));
    expect(await screen.findByText('Page 1 of 2')).toBeInTheDocument();
    expect(requested).toEqual([null, 'older-1', null]);
  });
});
