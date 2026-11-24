import React from 'react';
import { deferredFeature } from './deferredFeature';
import { Modal } from '../components/Modal';
const page = (label: string) => (content: React.ReactNode) => <main className="wrap"><h1>{label}</h1>{content}</main>;
export const Studio = deferredFeature(() => import('./editors').then(m => ({default: m.Studio})), 'Studio', page('Studio'));
export const Room = deferredFeature(() => import('./editors').then(m => ({default: m.Room})), 'Room planner', page('Room planner'));
export const Quiz = deferredFeature(() => import('./editors').then(m => ({default: m.Quiz})), 'Style quiz', page('Style quiz'));
export const ShareSheet = deferredFeature(() => import('./editors').then(m => ({default: m.ShareSheet})), 'Sharing tools', (content, props) => <Modal open label="Share" onClose={props.onClose}>{content}<button type="button" className="btn btn-line" onClick={props.onClose}>Close</button></Modal>);
