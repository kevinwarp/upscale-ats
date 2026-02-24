FROM php:7.4-apache

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libfreetype6-dev \
    libjpeg62-turbo-dev \
    libpng-dev \
    libldap2-dev \
    libxml2-dev \
    libzip-dev \
    zlib1g-dev \
    antiword \
    poppler-utils \
    html2text \
    unrtf \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-configure ldap --with-libdir=lib/x86_64-linux-gnu/ \
    && docker-php-ext-install \
        mysqli \
        gd \
        ldap \
        soap \
        zip \
        xml

# Enable Apache mod_rewrite
RUN a2enmod rewrite

# Download OpenCATS 0.9.7.4
RUN curl -L https://github.com/opencats/OpenCATS/releases/download/0.9.7.4/opencats-0.9.7.4-full.zip -o /tmp/opencats.zip \
    && unzip /tmp/opencats.zip -d /tmp/opencats \
    && cp -r /tmp/opencats/OpenCATS/. /var/www/html/ \
    && rm -rf /tmp/opencats /tmp/opencats.zip

# Set permissions
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html \
    && chmod -R 775 /var/www/html/attachments \
    && chmod -R 775 /var/www/html/upload \
    && chmod -R 775 /var/www/html/temp

# Copy enrichment module
COPY opencats-module/ /var/www/html/modules/enrichment/
RUN chown -R www-data:www-data /var/www/html/modules/enrichment

# Copy Golden Path module
COPY goldenpath-module/GoldenPathUI.php /var/www/html/modules/goldenpath/GoldenPathUI.php
COPY goldenpath-module/PipelineView.php /var/www/html/modules/goldenpath/PipelineView.php
COPY goldenpath-module/AnalyticsView.php /var/www/html/modules/goldenpath/AnalyticsView.php
COPY goldenpath-module/WorkflowView.php /var/www/html/modules/goldenpath/WorkflowView.php
COPY goldenpath-module/EmailLogView.php /var/www/html/modules/goldenpath/EmailLogView.php
COPY goldenpath-module/ReportsView.php /var/www/html/modules/goldenpath/ReportsView.php
COPY goldenpath-module/ImportView.php /var/www/html/modules/goldenpath/ImportView.php
COPY goldenpath-module/goldenpath.css /var/www/html/modules/goldenpath/goldenpath.css
RUN chown -R www-data:www-data /var/www/html/modules/goldenpath

# Register Golden Path module in OpenCATS module loader
# OpenCATS discovers modules by scanning MODULES_PATH for dirs with a *UI.php file.
# Our GoldenPathUI.php follows that convention, so it auto-registers.
# We also need to copy the CSS to the root css path so TemplateUtility can find it.
RUN mkdir -p /var/www/html/goldenpath && \
    cp /var/www/html/modules/goldenpath/goldenpath.css /var/www/html/goldenpath/goldenpath.css

# Pre-configure: bake in config.php and ensure INSTALL_BLOCK exists
COPY config.php /var/www/html/config.php
RUN mkdir -p /var/www/html/INSTALL_BLOCK && \
    chown www-data:www-data /var/www/html/config.php

# Upscale theme
COPY upscale-theme.css /var/www/html/upscale-theme.css
RUN sed -i 's|</head>|<link rel="stylesheet" type="text/css" href="upscale-theme.css" />\n</head>|g' \
    /var/www/html/lib/TemplateUtility.php && \
    sed -i 's|</head>|<link rel="stylesheet" type="text/css" href="upscale-theme.css" />\n</head>|g' \
    /var/www/html/modules/login/Login.tpl && \
    sed -i 's|</head>|<link rel="stylesheet" type="text/css" href="upscale-theme.css" />\n</head>|g' \
    /var/www/html/modules/install/notinstalled.php

# Apache config — allow .htaccess overrides
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf

EXPOSE 80

