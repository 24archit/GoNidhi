# Use an official Python runtime as a parent image
FROM python:3.10-slim

# Force Python to stream stdout/stderr without buffering
ENV PYTHONUNBUFFERED=1

# Set the working directory in the container
WORKDIR /code

# Install system dependencies required by OpenCV + git-lfs for model files
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 git git-lfs gcc g++ build-essential python3-dev \
    && git lfs install \
    && rm -rf /var/lib/apt/lists/*

# Copy the requirements file into the container
COPY ./requirements.txt /code/requirements.txt

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt
RUN pip install uvicorn python-dotenv

# Set workspace and copy application code
WORKDIR /code
COPY . /code

# Ensure LFS model files are resolved (not just pointers)
RUN if head -c 20 models/best.pt | grep -q "version https"; then \
    echo "ERROR: models/best.pt is still a Git LFS pointer!" && exit 1; \
    fi

# Hugging Face Spaces require port 7860
EXPOSE 7860

# Command to run the application on port 7860 with exactly 1 worker to protect the GPU lock
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]