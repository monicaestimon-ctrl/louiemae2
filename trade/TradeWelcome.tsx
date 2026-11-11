import React, { useEffect } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convex/_generated/api';
import { CredentialsForm } from '../components/account/CredentialsForm';

type Props = {
  signedIn: boolean;
  afterSignIn?: string;
  onNavigate: (route: string) => void;
  artwork: string[][];
};
export function TradeWelcome({ signedIn, afterSignIn = 'home', onNavigate, artwork }: Props) {
  const ensure = useMutation(api.holm.ensureProfile);
  const options = useQuery(api.holm.signInOptions);
  useEffect(() => {
    if (!signedIn) return;
    void ensure({}).catch(() => {});
    onNavigate(afterSignIn);
  }, [signedIn, ensure, onNavigate, afterSignIn]);
  return (
    <main className="welcome">
      <div className="wl-art">
        <div className="wl-cols" aria-hidden="true">
          {artwork.map((column, index) => (
            <div key={index} className="wl-col">
              {[...column, ...column].map((src, imageIndex) => (
                <img key={imageIndex} src={src} alt="" loading="lazy" />
              ))}
            </div>
          ))}
        </div>
        <div className="wl-mark">
          <div>
            <h1>House of Louie Mae</h1>
            <p>The trade floor for rooms people remember.</p>
          </div>
        </div>
      </div>
      <div className="wl-form">
        <CredentialsForm site="trade" googleEnabled={options?.google} afterSignIn={afterSignIn} />
      </div>
    </main>
  );
}
