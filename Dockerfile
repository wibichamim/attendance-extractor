# Step 1: Build the React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Step 2: Build the Python Flask backend with LibreOffice
FROM python:3.11-slim
WORKDIR /app

# Install LibreOffice and other dependencies
RUN apt-get update && apt-get install -y \
    libreoffice \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy python requirements and install them
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Copy the built frontend from step 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port and run the app
ENV PORT=5050
EXPOSE 5050
CMD ["gunicorn", "--bind", "0.0.0.0:5050", "--timeout", "120", "app:app"]
