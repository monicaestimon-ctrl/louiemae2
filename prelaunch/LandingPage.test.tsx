import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LandingPage } from './LandingPage';
describe('waitlist signup form', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('shows confirmation only after the server confirms a saved signup', async () => {
    let resolve: (value: unknown) => void;
    vi.stubGlobal('fetch',vi.fn(() => new Promise(r=>{resolve=r;})));
    render(<LandingPage />);
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'mae@example.com'}});
    fireEvent.submit(screen.getByRole('form'));
    expect(screen.queryByText('You’re on the list.')).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Joining…'})).toBeDisabled();
    resolve!({ok:true,json:async()=>({ok:true})});
    await waitFor(()=>expect(screen.getByText('You’re on the list.')).toBeInTheDocument());
  });
  it('keeps the email and offers retry when storage is unavailable', async () => {
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,json:async()=>({error:'Please try again shortly.'})})));
    render(<LandingPage />);
    fireEvent.change(screen.getByLabelText('Email address'),{target:{value:'mae@example.com'}});
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Please try again shortly.'));
    expect(screen.getByLabelText('Email address')).toHaveValue('mae@example.com');
    expect(screen.queryByText('You’re on the list.')).not.toBeInTheDocument();
  });
});
