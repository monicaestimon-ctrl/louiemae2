import React, { useState, useRef } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';
import { Upload, X, Loader2, Check } from 'lucide-react';
import { SafeImage } from './SafeImage';

interface ImageUploadProps {
    currentImage?: string;
    onImageChange: (url: string) => void;
    label?: string;
    className?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
    currentImage,
    onImageChange,
    label = "Upload Image",
    className = ""
}) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const generateUploadUrl = useMutation(api.files.generateUploadUrl);
    const saveFile = useMutation(api.files.saveFile);

    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        // Validate file size (max 5MB)
        if (file.size > 5 * 1024 * 1024) {
            alert('Image must be less than 5MB');
            return;
        }

        setIsUploading(true);
        setUploadSuccess(false);

        try {
            // Step 1: Get upload URL from Convex
            const uploadUrl = await generateUploadUrl();

            // Step 2: Upload the file to Convex storage
            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: { 'Content-Type': file.type },
                body: file,
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const { storageId } = await response.json();

            // Create preview
            const reader = new FileReader();
            reader.onload = (e) => {
                setPreviewUrl(e.target?.result as string);
            };
            reader.readAsDataURL(file);

            const result = await saveFile({ storageId, fileName: file.name, fileType: file.type, purpose: 'image-upload' });
            onImageChange(result.url || `convex-storage:${storageId}`);
            setUploadSuccess(true);

            // Reset success indicator after 2 seconds
            setTimeout(() => setUploadSuccess(false), 2000);

        } catch (error) {
            console.error('Upload error:', error);
            alert('Failed to upload image. Please try again.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        const file = event.dataTransfer.files?.[0];
        if (file && fileInputRef.current) {
            // Create a new DataTransfer to set the file
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInputRef.current.files = dataTransfer.files;
            // Trigger the change event
            const changeEvent = new Event('change', { bubbles: true });
            fileInputRef.current.dispatchEvent(changeEvent);
        }
    };

    const handleDragOver = (event: React.DragEvent) => {
        event.preventDefault();
    };

    const displayImage = previewUrl || currentImage;

    return (
        <div className={`relative ${className}`}>
            <label className="block text-xs uppercase tracking-wider text-earth/60 mb-2">
                {label}
            </label>

            <div
                className="relative border-2 border-dashed border-earth/20 rounded-xl overflow-hidden transition-all duration-300 hover:border-bronze/50 group"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
            >
                {displayImage ? (
                    <div className="relative aspect-video">
                        <SafeImage
                            src={displayImage}
                            alt="Preview"
                            className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-4 py-2 bg-white/90 text-earth rounded-lg text-sm font-medium hover:bg-white transition-colors"
                            >
                                Change Image
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className="aspect-video flex flex-col items-center justify-center cursor-pointer bg-cream/50 hover:bg-cream transition-colors"
                    >
                        <Upload className="w-8 h-8 text-earth/30 mb-2" />
                        <p className="text-sm text-earth/50">Click or drag to upload</p>
                        <p className="text-xs text-earth/30 mt-1">JPG, PNG, WebP up to 5MB</p>
                    </div>
                )}

                {/* Upload overlay */}
                {isUploading && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                        <Loader2 className="w-8 h-8 text-bronze animate-spin" />
                    </div>
                )}

                {/* Success indicator */}
                {uploadSuccess && (
                    <div className="absolute top-2 right-2 bg-green-500 text-white p-1 rounded-full">
                        <Check className="w-4 h-4" />
                    </div>
                )}
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
            />

            {/* URL input fallback */}
            <div className="mt-3">
                <input
                    type="text"
                    value={currentImage || ''}
                    onChange={(e) => onImageChange(e.target.value)}
                    placeholder="Or paste image URL..."
                    className="w-full px-3 py-2 text-sm border border-earth/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-bronze/30"
                />
            </div>
        </div>
    );
};

export default ImageUpload;
