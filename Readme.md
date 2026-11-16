check this hello
SO basically currently what i have done is made simple two services, which allow me to test a simple distributed trace

to run 

go to services
#cd services

then gateway
$cd gateway
$go mod tidy
$go run .


then in auth-service
$go mod tidy
$go run .


then check in your locally hosted jaeger through docker