pipeline {
  agent { label 'cambo-linux' }

  options {
    disableConcurrentBuilds()
    skipDefaultCheckout()
    timeout(time: 75, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  triggers {
    pollSCM('H/5 * * * *')
  }

  parameters {
    booleanParam(name: 'RELEASE', defaultValue: false, description: 'Publish the images and deploy the checked main commit.')
    string(name: 'PUBLIC_ORIGIN', defaultValue: '', description: 'Production HTTPS origin for the web image.')
    string(name: 'TELEGRAM_BOT_USERNAME', defaultValue: '', description: 'Production bot username without @.')
    string(name: 'DEPLOY_HOST', defaultValue: '', description: 'DigitalOcean hostname or IPv4 address for SSH.')
  }

  stages {
    stage('Checkout') {
      steps {
        deleteDir()
        checkout scm
        script {
          env.CAMBO_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim()
          env.CAMBO_TAG = "sha-${env.CAMBO_SHA.take(7)}"
        }
      }
    }

    stage('Terraform') {
      steps {
        sh '''
          set -eu
          terraform -chdir=infra/terraform fmt -check -recursive
          terraform -chdir=infra/terraform init -backend=false -lockfile=readonly -input=false
          terraform -chdir=infra/terraform validate
        '''
      }
    }

    stage('Lint, test, build and smoke') {
      steps {
        sh 'bash scripts/jenkins-checks.sh'
      }
    }

    stage('Publish images') {
      when { expression { params.RELEASE } }
      steps {
        sh '''
          set -eu
          main_sha="$(git ls-remote --exit-code origin refs/heads/main | cut -f1)"
          test "$CAMBO_SHA" = "$main_sha" || { echo "Release requires the current main commit"; exit 1; }
          printf '%s\\n' "$PUBLIC_ORIGIN" | grep -Eq '^https://[a-zA-Z0-9.-]+$'
          printf '%s\\n' "$TELEGRAM_BOT_USERNAME" | grep -Eq '^[a-zA-Z0-9_]+$'
          printf '%s\\n' "$DEPLOY_HOST" | grep -Eq '^[a-zA-Z0-9][a-zA-Z0-9.-]*$'
        '''
        withCredentials([usernamePassword(credentialsId: 'cambo-ghcr', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN')]) {
          sh '''
            set +x
            set -eu
            registry_config="$(mktemp -d)"
            trap 'rm -rf -- "$registry_config"' EXIT
            printf '%s\\n' '{"auths":{"ghcr.io":{}}}' > "$registry_config/config.json"
            printf '%s\\n' "$GHCR_TOKEN" | docker --config "$registry_config" login ghcr.io --username "$GHCR_USER" --password-stdin
            missing=''
            for service in api file report notification web; do
              image="ghcr.io/vichea-collab/cambokb-$service:$CAMBO_TAG"
              if docker --config "$registry_config" buildx imagetools inspect "$image" >/dev/null 2>"$registry_config/inspect-error"; then
                echo "Reusing published image $image"
                continue
              fi
              if ! grep -Fq "$image: not found" "$registry_config/inspect-error" &&
                 ! grep -Eiq 'manifest unknown|no such manifest' "$registry_config/inspect-error"; then
                cat "$registry_config/inspect-error" >&2
                exit 1
              fi
              missing="$missing $service"
              if [ "$service" = web ]; then
                docker build --platform linux/amd64 -f docker/web.Dockerfile -t "$image" \\
                  --build-arg "VITE_SITE_URL=$PUBLIC_ORIGIN" \\
                  --build-arg "VITE_TELEGRAM_BOT_USERNAME=$TELEGRAM_BOT_USERNAME" .
              else
                docker build --platform linux/amd64 -f "docker/$service.Dockerfile" -t "$image" .
              fi
            done
            for service in $missing; do
              docker --config "$registry_config" push "ghcr.io/vichea-collab/cambokb-$service:$CAMBO_TAG"
            done
          '''
        }
      }
    }

    stage('Deploy') {
      when { expression { params.RELEASE } }
      steps {
        withCredentials([
          sshUserPrivateKey(credentialsId: 'cambo-deploy-key', keyFileVariable: 'DEPLOY_KEY'),
          file(credentialsId: 'cambo-deploy-known-hosts', variable: 'DEPLOY_KNOWN_HOSTS')
        ]) {
          sh '''
            set +x
            set -eu
            main_sha="$(git ls-remote --exit-code origin refs/heads/main | cut -f1)"
            test "$CAMBO_SHA" = "$main_sha" || { echo "main advanced before deploy"; exit 1; }
            ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \\
              -o UserKnownHostsFile="$DEPLOY_KNOWN_HOSTS" -o ConnectTimeout=30 -o ServerAliveInterval=20 \\
              "deploy@$DEPLOY_HOST" "deploy $CAMBO_SHA"
          '''
        }
      }
    }
  }
}
